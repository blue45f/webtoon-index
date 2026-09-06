import {
  STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS,
  studioOpenCvImageFailure,
  type StudioOpenCvImageRequest,
  type StudioOpenCvImageResult,
} from "./studio-opencv-image-provider";
import {
  STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
  isStudioOpenCvImageWorkerOutboundMessage,
  studioOpenCvImageRequestTransfers,
  type StudioOpenCvImageWorkerAdvanceEpochMessage,
  type StudioOpenCvImageWorkerCancelMessage,
  type StudioOpenCvImageWorkerExecuteMessage,
  type StudioOpenCvImageWorkerInboundMessage,
} from "./studio-opencv-image-worker-protocol";

export const STUDIO_OPENCV_IMAGE_WORKER_STARTUP_TIMEOUT_MS = 15_000;
export const STUDIO_OPENCV_IMAGE_WORKER_REQUEST_TIMEOUT_MS = 60_000;
export const STUDIO_OPENCV_IMAGE_WORKER_MAX_PENDING_REQUESTS = 8;

interface StudioOpenCvWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioOpenCvWorkerErrorEvent {
  preventDefault?(): void;
}

export interface StudioOpenCvImageWorkerLike {
  postMessage(
    message: StudioOpenCvImageWorkerInboundMessage,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: StudioOpenCvWorkerMessageEvent) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: StudioOpenCvWorkerErrorEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: StudioOpenCvWorkerMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: StudioOpenCvWorkerErrorEvent) => void,
  ): void;
  terminate(): void;
}

export interface StudioOpenCvImageWorkerFallbackReceipt {
  readonly kind: "no-fallback";
  readonly workerAvailable: false;
  readonly mainThreadSynchronousFallback: false;
  readonly reason:
    | "construction-failed"
    | "startup-timeout"
    | "worker-error"
    | "protocol-error";
}

export interface StudioOpenCvImageWorkerUnavailable {
  readonly ok: false;
  readonly reason: "worker-unavailable";
  readonly detail: string;
  readonly fallback: StudioOpenCvImageWorkerFallbackReceipt;
}

export type StudioOpenCvImageWorkerResult =
  | StudioOpenCvImageResult
  | StudioOpenCvImageWorkerUnavailable;

export interface StudioOpenCvImageWorkerClientOptions {
  readonly requestEpoch: number;
  readonly workerFactory?: () => StudioOpenCvImageWorkerLike;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxPendingRequests?: number;
}

export interface StudioOpenCvImageWorkerClientDiagnostics {
  readonly phase: "cold" | "starting" | "ready" | "unavailable" | "disposed";
  readonly requestEpoch: number;
  readonly pendingRequestCount: number;
}

interface PendingRequest {
  readonly requestEpoch: number;
  readonly resolve: (result: StudioOpenCvImageWorkerResult) => void;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function defaultWorkerFactory(): StudioOpenCvImageWorkerLike {
  return new Worker(new URL("./studio-opencv-image-provider.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-opencv-image-provider",
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedStartupTimeout(value: number | undefined): number {
  if (value === undefined) return STUDIO_OPENCV_IMAGE_WORKER_STARTUP_TIMEOUT_MS;
  if (!Number.isFinite(value)) {
    throw new TypeError("startupTimeoutMs must be finite");
  }
  return Math.max(250, Math.min(60_000, Math.floor(value)));
}

function boundedPendingRequests(value: number | undefined): number {
  if (value === undefined) return STUDIO_OPENCV_IMAGE_WORKER_MAX_PENDING_REQUESTS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 64) {
    throw new TypeError("maxPendingRequests must be from one to sixty-four");
  }
  return value;
}

function unavailable(
  reason: StudioOpenCvImageWorkerFallbackReceipt["reason"],
): StudioOpenCvImageWorkerUnavailable {
  return Object.freeze({
    ok: false,
    reason: "worker-unavailable",
    detail: `OpenCV Worker is unavailable: ${reason}`,
    fallback: Object.freeze({
      kind: "no-fallback",
      workerAvailable: false,
      mainThreadSynchronousFallback: false,
      reason,
    }),
  });
}

function hasOnlyOwnDataGraph(root: unknown): boolean {
  const stack: unknown[] = [root];
  const seen = new Set<object>();
  let visited = 0;
  while (stack.length > 0) {
    const value = stack.pop();
    if (
      value === null
      || value === undefined
      || typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
      || ArrayBuffer.isView(value)
      || value instanceof ArrayBuffer
    ) {
      continue;
    }
    if (
      typeof value !== "object"
      || (!Array.isArray(value) && !isPlainRecord(value))
      || seen.has(value)
    ) {
      return false;
    }
    seen.add(value);
    visited += 1;
    if (visited > 128) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!("value" in descriptor)) return false;
      if (Array.isArray(value) && key === "length") continue;
      stack.push(descriptor.value);
    }
  }
  return true;
}

function snapshotRequest(candidate: unknown): StudioOpenCvImageRequest | null {
  try {
    if (
      !isPlainRecord(candidate)
      || !hasOnlyOwnDataGraph(candidate)
      || !isPlainRecord(candidate.image)
      || (
        !(candidate.image.data instanceof Uint8Array)
        && !(candidate.image.data instanceof Uint8ClampedArray)
      )
      || candidate.image.data.byteLength
        > STUDIO_OPENCV_IMAGE_PROVIDER_LIMITS.maxInputBytes
    ) {
      return null;
    }
    const snapshot = structuredClone(candidate) as unknown;
    if (
      !isPlainRecord(snapshot)
      || !isPlainRecord(snapshot.image)
      || (
        !(snapshot.image.data instanceof Uint8Array)
        && !(snapshot.image.data instanceof Uint8ClampedArray)
      )
    ) {
      return null;
    }
    return snapshot as unknown as StudioOpenCvImageRequest;
  } catch {
    return null;
  }
}

export class StudioOpenCvImageWorkerClient {
  private readonly workerFactory: () => StudioOpenCvImageWorkerLike;
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private worker: StudioOpenCvImageWorkerLike | null = null;
  private phase: StudioOpenCvImageWorkerClientDiagnostics["phase"] = "cold";
  private currentRequestEpoch: number;
  private nextRequestId = 1;
  private admittedRequestCount = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readyPromise: Promise<boolean> | null = null;
  private resolveReady: ((ready: boolean) => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private unavailableReceipt: StudioOpenCvImageWorkerUnavailable | null = null;

  constructor(options: StudioOpenCvImageWorkerClientOptions) {
    if (
      !isPlainRecord(options)
      || !Object.keys(options).every(
        (key) => (
          key === "requestEpoch"
          || key === "workerFactory"
          || key === "startupTimeoutMs"
          || key === "requestTimeoutMs"
          || key === "maxPendingRequests"
        ),
      )
      || !Object.hasOwn(options, "requestEpoch")
      || !Number.isSafeInteger(options.requestEpoch)
      || options.requestEpoch < 0
      || (
        options.workerFactory !== undefined
        && typeof options.workerFactory !== "function"
      )
    ) {
      throw new TypeError("OpenCV Worker client options are invalid");
    }
    this.currentRequestEpoch = options.requestEpoch;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.startupTimeoutMs = boundedStartupTimeout(options.startupTimeoutMs);
    this.requestTimeoutMs = boundedStartupTimeout(
      options.requestTimeoutMs
        ?? STUDIO_OPENCV_IMAGE_WORKER_REQUEST_TIMEOUT_MS,
    );
    this.maxPendingRequests = boundedPendingRequests(options.maxPendingRequests);
  }

  private clearStartupTimer(): void {
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private detachWorker(): void {
    if (this.worker === null) return;
    try {
      this.worker.removeEventListener("message", this.onMessage);
      this.worker.removeEventListener("error", this.onWorkerError);
      this.worker.removeEventListener("messageerror", this.onWorkerError);
      this.worker.terminate();
    } catch {
      // A host Worker shim cannot prevent deterministic settlement.
    }
    this.worker = null;
  }

  private settlePending(
    requestId: number,
    result: StudioOpenCvImageWorkerResult,
  ): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.abort);
    pending.resolve(result);
  }

  private failWorker(
    reason: StudioOpenCvImageWorkerFallbackReceipt["reason"],
  ): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    this.unavailableReceipt = unavailable(reason);
    this.phase = "unavailable";
    this.detachWorker();
    this.resolveReady?.(false);
    this.resolveReady = null;
    for (const requestId of [...this.pending.keys()]) {
      this.settlePending(requestId, this.unavailableReceipt);
    }
  }

  private restartCold(
    primaryRequestId: number | null,
    primaryResult: StudioOpenCvImageWorkerResult,
  ): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    this.detachWorker();
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.readyPromise = null;
    this.phase = "cold";
    if (primaryRequestId !== null) {
      this.settlePending(primaryRequestId, primaryResult);
    }
    const collateral = studioOpenCvImageFailure(
      "provider-failure",
      "OpenCV Worker was restarted",
    );
    for (const requestId of [...this.pending.keys()]) {
      this.settlePending(requestId, collateral);
    }
  }

  private readonly onMessage = (event: StudioOpenCvWorkerMessageEvent): void => {
    if (
      this.phase === "disposed"
      || !isStudioOpenCvImageWorkerOutboundMessage(event.data)
    ) {
      if (this.phase !== "disposed") this.failWorker("protocol-error");
      return;
    }
    const message = event.data;
    if (message.type === "studio-opencv-image/ready") {
      if (this.phase !== "starting" || this.worker === null) {
        this.failWorker("protocol-error");
        return;
      }
      if (message.requestEpoch > this.currentRequestEpoch) {
        this.failWorker("protocol-error");
        return;
      }
      if (message.requestEpoch < this.currentRequestEpoch) {
        const advance: StudioOpenCvImageWorkerAdvanceEpochMessage = {
          type: "studio-opencv-image/advance-epoch",
          version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
          requestEpoch: this.currentRequestEpoch,
        };
        try {
          this.worker.postMessage(advance);
        } catch {
          this.failWorker("worker-error");
          return;
        }
      }
      this.clearStartupTimer();
      this.phase = "ready";
      this.resolveReady?.(true);
      this.resolveReady = null;
      return;
    }
    if (this.phase !== "ready" || !this.pending.has(message.requestId)) {
      this.failWorker("protocol-error");
      return;
    }
    this.settlePending(message.requestId, message.result);
  };

  private readonly onWorkerError = (event: StudioOpenCvWorkerErrorEvent): void => {
    event.preventDefault?.();
    this.failWorker("worker-error");
  };

  private ensureReady(): Promise<boolean> {
    if (this.phase === "ready") return Promise.resolve(true);
    if (this.phase === "unavailable" || this.phase === "disposed") {
      return Promise.resolve(false);
    }
    if (this.readyPromise !== null) return this.readyPromise;

    this.phase = "starting";
    this.readyPromise = new Promise<boolean>((resolve) => {
      this.resolveReady = resolve;
    });
    try {
      this.worker = this.workerFactory();
      this.worker.addEventListener("message", this.onMessage);
      this.worker.addEventListener("error", this.onWorkerError);
      this.worker.addEventListener("messageerror", this.onWorkerError);
    } catch {
      this.failWorker("construction-failed");
      return this.readyPromise;
    }
    this.startupTimer = setTimeout(
      () => this.failWorker("startup-timeout"),
      this.startupTimeoutMs,
    );
    return this.readyPromise;
  }

  public async execute(
    candidate: unknown,
    signal?: AbortSignal,
  ): Promise<StudioOpenCvImageWorkerResult> {
    if (this.phase === "disposed") {
      return studioOpenCvImageFailure("disposed", "OpenCV Worker client is disposed");
    }
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      return studioOpenCvImageFailure(
        "invalid-input",
        "OpenCV Worker signal is invalid",
      );
    }
    if (signal?.aborted) {
      return studioOpenCvImageFailure("cancelled", "OpenCV Worker request was cancelled");
    }
    if (this.admittedRequestCount >= this.maxPendingRequests) {
      return studioOpenCvImageFailure(
        "backpressure",
        "OpenCV Worker pending-request budget exceeded",
      );
    }
    const request = snapshotRequest(candidate);
    if (request === null) {
      return studioOpenCvImageFailure(
        "invalid-input",
        "OpenCV Worker request could not be cloned",
      );
    }
    if (request.requestEpoch !== this.currentRequestEpoch) {
      return studioOpenCvImageFailure(
        "stale-request-epoch",
        "OpenCV Worker request epoch is stale",
      );
    }

    this.admittedRequestCount += 1;
    try {
      let abortedDuringStartup = false;
      const startupAbort = (): void => {
        abortedDuringStartup = true;
        this.restartCold(
          null,
          studioOpenCvImageFailure("cancelled", "OpenCV Worker request was cancelled"),
        );
      };
      signal?.addEventListener("abort", startupAbort, { once: true });
      const ready = await this.ensureReady();
      signal?.removeEventListener("abort", startupAbort);
      if (abortedDuringStartup || signal?.aborted) {
        return studioOpenCvImageFailure("cancelled", "OpenCV Worker request was cancelled");
      }
      if (!ready || this.worker === null) {
        return this.unavailableReceipt ?? unavailable("construction-failed");
      }
      if (request.requestEpoch !== this.currentRequestEpoch) {
        return studioOpenCvImageFailure(
          "stale-request-epoch",
          "OpenCV Worker request became stale during startup",
        );
      }

      const requestId = this.nextRequestId;
      this.nextRequestId = requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
      const message: StudioOpenCvImageWorkerExecuteMessage = {
        type: "studio-opencv-image/execute",
        version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
        requestId,
        request,
      };
      return await new Promise<StudioOpenCvImageWorkerResult>((resolve) => {
        const abort = (): void => {
          if (!this.pending.has(requestId)) return;
          const cancel: StudioOpenCvImageWorkerCancelMessage = {
            type: "studio-opencv-image/cancel",
            version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
            requestId,
          };
          try {
            this.worker?.postMessage(cancel);
          } catch {
            // Worker termination below remains authoritative.
          }
          this.restartCold(
            requestId,
            studioOpenCvImageFailure("cancelled", "OpenCV Worker request was cancelled"),
          );
        };
        const timer = setTimeout(() => {
          this.restartCold(
            requestId,
            studioOpenCvImageFailure(
              "time-budget-exceeded",
              "OpenCV Worker was terminated after exceeding its time budget",
            ),
          );
        }, this.requestTimeoutMs);
        this.pending.set(requestId, {
          requestEpoch: request.requestEpoch,
          resolve,
          signal,
          abort,
          timer,
        });
        signal?.addEventListener("abort", abort, { once: true });
        try {
          this.worker?.postMessage(message, studioOpenCvImageRequestTransfers(message));
        } catch {
          this.failWorker("worker-error");
        }
      });
    } finally {
      this.admittedRequestCount -= 1;
    }
  }

  public advanceRequestEpoch(nextEpoch: number): boolean {
    if (
      this.phase === "disposed"
      || !Number.isSafeInteger(nextEpoch)
      || nextEpoch <= this.currentRequestEpoch
    ) {
      return false;
    }
    this.currentRequestEpoch = nextEpoch;
    if (this.pending.size > 0) {
      this.clearStartupTimer();
      this.detachWorker();
      this.resolveReady?.(false);
      this.resolveReady = null;
      this.readyPromise = null;
      this.phase = "cold";
      for (const requestId of [...this.pending.keys()]) {
        this.settlePending(
          requestId,
          studioOpenCvImageFailure(
            "stale-request-epoch",
            "OpenCV Worker request became stale",
          ),
        );
      }
      return true;
    }
    if (this.worker !== null && this.phase === "ready") {
      try {
        this.worker.postMessage({
          type: "studio-opencv-image/advance-epoch",
          version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
          requestEpoch: nextEpoch,
        });
      } catch {
        this.failWorker("worker-error");
      }
    }
    return true;
  }

  public getDiagnostics(): StudioOpenCvImageWorkerClientDiagnostics {
    return Object.freeze({
      phase: this.phase,
      requestEpoch: this.currentRequestEpoch,
      pendingRequestCount: this.pending.size,
    });
  }

  public dispose(): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    this.phase = "disposed";
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.detachWorker();
    for (const requestId of [...this.pending.keys()]) {
      this.settlePending(
        requestId,
        studioOpenCvImageFailure("disposed", "OpenCV Worker client is disposed"),
      );
    }
  }
}

export function createStudioOpenCvImageWorkerClient(
  options: StudioOpenCvImageWorkerClientOptions,
): StudioOpenCvImageWorkerClient {
  return new StudioOpenCvImageWorkerClient(options);
}
