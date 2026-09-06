import {
  isStudioLivingInkExecutionReadbackProvenance,
  STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
  STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
  type StudioLivingInkExecutionApplyOptions,
  type StudioLivingInkExecutionApplied,
  type StudioLivingInkExecutionApplyResult,
  type StudioLivingInkExecutionCapabilities,
  type StudioLivingInkExecutionConfig,
  type StudioLivingInkExecutionFrame,
  type StudioLivingInkExecutionProviderId,
  type StudioLivingInkWorkerRequest,
  type StudioLivingInkWorkerResponse,
} from "./studio-living-ink-execution-protocol";

import type { StudioLivingInkOperation } from "./studio-living-ink-field";
import type { StudioLivingInkDisplayMode } from "./studio-living-ink-gpu-protocol";

export interface StudioLivingInkWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: StudioLivingInkWorkerRequest): void;
  terminate(): void;
}

export interface StudioLivingInkProviderOptions {
  /** Immutable provider selection for this Worker epoch. */
  readonly backend: StudioLivingInkExecutionProviderId;
  readonly workerFactory?: () => StudioLivingInkWorkerLike;
  readonly requestTimeoutMilliseconds?: number;
}

interface PendingRequest<T = unknown> {
  readonly epoch: number;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal | null;
  readonly abortListener: (() => void) | null;
}

export class StudioLivingInkExecutionError extends Error {
  readonly code: Extract<StudioLivingInkWorkerResponse, { type: "living-ink/error" }>["code"];

  constructor(code: StudioLivingInkExecutionError["code"], message: string) {
    super(message);
    this.name = code === "cancelled" ? "AbortError" : "StudioLivingInkExecutionError";
    this.code = code;
  }
}

function defaultWorkerFactory(): StudioLivingInkWorkerLike {
  return new Worker(new URL("./studio-living-ink.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-living-ink-selected-gpu",
  });
}

function validResponse(value: unknown): value is StudioLivingInkWorkerResponse {
  if (value === null || typeof value !== "object") return false;
  const response = value as Partial<StudioLivingInkWorkerResponse>;
  return response.version === STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION
    && typeof response.requestId === "number"
    && Number.isSafeInteger(response.requestId)
    && response.requestId > 0
    && typeof response.type === "string";
}

function closeFrameImage(value: unknown): void {
  if (value && typeof value === "object" && "close" in value) {
    const close = (value as { close?: unknown }).close;
    if (typeof close === "function") close.call(value);
  }
}

function validFrameResponse(
  response: Extract<StudioLivingInkWorkerResponse, { type: "living-ink/frame" }>,
): boolean {
  const image = response.frame?.image as unknown;
  const receipt = response.frame?.receipt;
  return image !== null
    && typeof image === "object"
    && typeof (image as { close?: unknown }).close === "function"
    && receipt?.kind === "studio-living-ink-execution-receipt"
    && receipt.version === STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION
    && receipt.engineVersion === STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION
    && receipt.requestId === response.requestId
    && /^sha256:[0-9a-f]{64}$/.test(receipt.displaySha256)
    && (
      receipt.displayHashEncoding === undefined
      || receipt.displayHashEncoding === "premultiplied-rgba8-v2"
    )
    && /^sha256:[0-9a-f]{64}$/.test(receipt.operationSha256)
    && receipt.imageOwnership === "caller-must-close"
    && isStudioLivingInkExecutionReadbackProvenance(receipt);
}

function validAppliedResponse(
  response: Extract<StudioLivingInkWorkerResponse, { type: "living-ink/applied" }>,
): boolean {
  const applied = response.applied;
  return applied?.kind === "living-ink/applied"
    && applied.version === STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION
    && applied.requestId === response.requestId
    && Number.isSafeInteger(applied.revision)
    && applied.revision > 0
    && /^sha256:[0-9a-f]{64}$/.test(applied.operationSha256)
    && applied.presented === false
    && applied.displayReadbackCount === 0
    && applied.imageBitmapCount === 0
    && !("displaySha256" in applied)
    && !("image" in applied);
}

/**
 * Dedicated-Worker client. Requests are serialized, so no pointer input is dropped and at most one
 * GPU frame is in flight. A returned ImageBitmap belongs to the caller and must be closed.
 */
export class StudioLivingInkExecutionProvider {
  private readonly config: StudioLivingInkExecutionConfig;
  private readonly options: StudioLivingInkProviderOptions;
  private readonly pending = new Map<number, PendingRequest>();
  private worker: StudioLivingInkWorkerLike | null = null;
  private requestId = 0;
  private epoch = 1;
  private operationQueue = Promise.resolve();
  private disposed = false;
  private initialized = false;

  constructor(config: StudioLivingInkExecutionConfig, options: StudioLivingInkProviderOptions) {
    this.config = Object.freeze({ ...config });
    this.options = Object.freeze({ ...options });
  }

  private selectedReceiptBackend(): StudioLivingInkExecutionCapabilities["backend"] {
    return this.options.backend === "webgpu"
      ? "webgpu-offscreen-half-float"
      : "webgl2-offscreen-half-float";
  }

  private nextRequestId(): number {
    this.requestId += 1;
    return this.requestId;
  }

  private ensureWorker(): StudioLivingInkWorkerLike {
    if (this.disposed) throw new Error("Living Ink provider is disposed.");
    if (this.worker) return this.worker;
    const worker = (this.options.workerFactory ?? defaultWorkerFactory)();
    const boundEpoch = this.epoch;
    worker.onmessage = (event) => this.receive(event.data, boundEpoch);
    worker.onmessageerror = () => this.failEpoch(boundEpoch, new Error("Living Ink Worker message clone failed."));
    worker.onerror = (event) => {
      event.preventDefault?.();
      this.failEpoch(
        boundEpoch,
        new Error(event.message || "Living Ink Worker crashed before completing its request."),
      );
    };
    this.worker = worker;
    return worker;
  }

  private finishPending(requestId: number): PendingRequest | null {
    const pending = this.pending.get(requestId);
    if (!pending) return null;
    this.pending.delete(requestId);
    clearTimeout(pending.timeout);
    if (pending.signal && pending.abortListener) {
      pending.signal.removeEventListener("abort", pending.abortListener);
    }
    return pending;
  }

  private receive(value: unknown, boundEpoch: number): void {
    if (!validResponse(value)) {
      this.failEpoch(boundEpoch, new Error("Living Ink Worker returned an invalid response."));
      return;
    }
    const response = value;
    if (boundEpoch !== this.epoch || this.disposed) {
      if (response.type === "living-ink/frame") response.frame.image.close();
      return;
    }
    if (response.type === "living-ink/fatal") {
      this.failEpoch(boundEpoch, new StudioLivingInkExecutionError(response.code, response.message));
      return;
    }
    if (
      response.type === "living-ink/frame"
      && (
        !validFrameResponse(response)
        || response.frame.receipt.backend !== this.selectedReceiptBackend()
      )
    ) {
      closeFrameImage(response.frame?.image);
      const error = new Error("Living Ink Worker returned an invalid frame contract.");
      this.finishPending(response.requestId)?.reject(error);
      this.failEpoch(boundEpoch, error);
      return;
    }
    if (
      response.type === "living-ink/applied"
      && (
        !validAppliedResponse(response)
        || response.applied.backend !== this.selectedReceiptBackend()
      )
    ) {
      const error = new Error("Living Ink Worker returned an invalid simulation acknowledgement.");
      this.finishPending(response.requestId)?.reject(error);
      this.failEpoch(boundEpoch, error);
      return;
    }
    const pending = this.finishPending(response.requestId);
    if (!pending) {
      if (response.type === "living-ink/frame") response.frame.image.close();
      return;
    }
    if (pending.epoch !== boundEpoch) {
      if (response.type === "living-ink/frame") response.frame.image.close();
      pending.reject(new Error("Living Ink Worker response belongs to a stale epoch."));
      return;
    }
    if (response.type === "living-ink/error") {
      pending.reject(new StudioLivingInkExecutionError(response.code, response.message));
      return;
    }
    pending.resolve(response);
  }

  private failEpoch(boundEpoch: number, error: Error): void {
    if (boundEpoch !== this.epoch) return;
    const failedWorker = this.worker;
    this.worker = null;
    this.initialized = false;
    this.epoch += 1;
    failedWorker?.terminate();
    for (const requestId of [...this.pending.keys()]) {
      this.finishPending(requestId)?.reject(error);
    }
  }

  private sendCancel(targetRequestId: number): void {
    const worker = this.worker;
    if (!worker || this.disposed) return;
    worker.postMessage({
      type: "living-ink/cancel",
      version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
      requestId: this.nextRequestId(),
      targetRequestId,
    });
  }

  private request<T extends StudioLivingInkWorkerResponse>(
    request: StudioLivingInkWorkerRequest,
    signal: AbortSignal | null = null,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(new DOMException("Living Ink request cancelled.", "AbortError"));
    const worker = this.ensureWorker();
    const epoch = this.epoch;
    return new Promise<T>((resolve, reject) => {
      const timeoutMilliseconds = this.options.requestTimeoutMilliseconds ?? 60_000;
      const timeout = setTimeout(() => {
        this.sendCancel(request.requestId);
        this.finishPending(request.requestId)?.reject(new Error("Living Ink Worker request timed out."));
      }, timeoutMilliseconds);
      const abortListener = signal ? () => this.sendCancel(request.requestId) : null;
      this.pending.set(request.requestId, {
        epoch,
        resolve: (response) => resolve(response as T),
        reject,
        timeout,
        signal,
        abortListener,
      });
      signal?.addEventListener("abort", abortListener!, { once: true });
      worker.postMessage(request);
    });
  }

  async initialize(): Promise<StudioLivingInkExecutionCapabilities> {
    if (this.initialized) throw new Error("Living Ink provider is already initialized.");
    const response = await this.request<Extract<StudioLivingInkWorkerResponse, { type: "living-ink/ready" }>>({
      type: "living-ink/initialize",
      version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
      requestId: this.nextRequestId(),
      backend: this.options.backend,
      config: this.config,
    });
    if (
      response.type !== "living-ink/ready"
      || response.capabilities.backend !== this.selectedReceiptBackend()
    ) {
      const error = new Error(
        "Living Ink Worker did not initialize the explicitly selected backend.",
      );
      this.failEpoch(this.epoch, error);
      throw error;
    }
    this.initialized = true;
    return response.capabilities;
  }

  apply(
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions & Readonly<{ present: false }>,
    signal?: AbortSignal | null,
  ): Promise<StudioLivingInkExecutionApplied>;
  apply(
    operation: StudioLivingInkOperation,
    options?: StudioLivingInkExecutionApplyOptions & Readonly<{ present?: true }>,
    signal?: AbortSignal | null,
  ): Promise<StudioLivingInkExecutionFrame>;
  apply(
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions,
    signal?: AbortSignal | null,
  ): Promise<StudioLivingInkExecutionApplyResult>;
  apply(
    operation: StudioLivingInkOperation,
    options: StudioLivingInkExecutionApplyOptions = {},
    signal: AbortSignal | null = null,
  ): Promise<StudioLivingInkExecutionApplyResult> {
    const execute = async (): Promise<StudioLivingInkExecutionApplyResult> => {
      if (!this.initialized) throw new Error("Living Ink provider is not initialized.");
      const response = await this.request<Extract<
        StudioLivingInkWorkerResponse,
        { type: "living-ink/frame" | "living-ink/applied" }
      >>({
        type: "living-ink/apply",
        version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
        requestId: this.nextRequestId(),
        operation,
        options,
      }, signal);
      if (options.present === false) {
        if (response.type !== "living-ink/applied") {
          if (response.type === "living-ink/frame") response.frame.image.close();
          throw new Error("Living Ink Worker presented a frame for a simulation-only request.");
        }
        return response.applied;
      }
      if (response.type !== "living-ink/frame") {
        throw new Error("Living Ink Worker returned no presentation frame.");
      }
      return response.frame;
    };
    const result = this.operationQueue.then(execute, execute);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  render(displayMode: StudioLivingInkDisplayMode): Promise<StudioLivingInkExecutionFrame> {
    const execute = async (): Promise<StudioLivingInkExecutionFrame> => {
      if (!this.initialized) throw new Error("Living Ink provider is not initialized.");
      const response = await this.request<Extract<StudioLivingInkWorkerResponse, { type: "living-ink/frame" }>>({
        type: "living-ink/render",
        version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
        requestId: this.nextRequestId(),
        displayMode,
      });
      if (response.type !== "living-ink/frame") throw new Error("Living Ink Worker returned no frame.");
      return response.frame;
    };
    const result = this.operationQueue.then(execute, execute);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch += 1;
    const worker = this.worker;
    this.worker = null;
    for (const requestId of [...this.pending.keys()]) {
      this.finishPending(requestId)?.reject(new Error("Living Ink provider was disposed."));
    }
    if (worker) {
      try {
        worker.postMessage({
          type: "living-ink/dispose",
          version: STUDIO_LIVING_INK_EXECUTION_PROTOCOL_VERSION,
          requestId: this.nextRequestId(),
        });
      } finally {
        worker.terminate();
      }
    }
    await this.operationQueue;
  }
}

export async function createStudioLivingInkExecutionProvider(
  config: StudioLivingInkExecutionConfig,
  options: StudioLivingInkProviderOptions,
): Promise<StudioLivingInkExecutionProvider> {
  const provider = new StudioLivingInkExecutionProvider(config, options);
  await provider.initialize();
  return provider;
}
