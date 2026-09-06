import {
  StudioLayerLiftMaskWorkerProtocolError,
  admitStudioLayerLiftMaskWorkerInput,
  createStudioLayerLiftMaskWorkerRunMessage,
  decodeStudioLayerLiftMaskWorkerResult,
  isStudioLayerLiftMaskWorkerResponseMessage,
  studioLayerLiftMaskWorkerRequestTransfers,
  studioLayerLiftMaskWorkerResponseIdentity,
  type StudioLayerLiftMaskWorkerInput,
  type StudioLayerLiftMaskWorkerPreflightFailureCode,
  type StudioLayerLiftMaskWorkerResponseMessage,
  type StudioLayerLiftMaskWorkerRunMessage,
} from "./studio-layer-lift-mask-worker-protocol";

import type { StudioLayerLiftPreparationResult } from "./studio-layer-lift-mask";

export const STUDIO_LAYER_LIFT_MASK_WORKER_DEFAULT_TIMEOUT_MS = 30_000;
export const STUDIO_LAYER_LIFT_MASK_WORKER_MAX_TIMEOUT_MS = 120_000;

export type StudioLayerLiftMaskWorkerClientErrorCode =
  | StudioLayerLiftMaskWorkerPreflightFailureCode
  | "worker-disposed"
  | "worker-post-failed"
  | "worker-protocol"
  | "worker-runtime"
  | "worker-timeout"
  | "worker-unavailable";

export class StudioLayerLiftMaskWorkerClientError extends Error {
  constructor(
    readonly code: StudioLayerLiftMaskWorkerClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudioLayerLiftMaskWorkerClientError";
  }
}

export interface StudioLayerLiftMaskWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  onmessageerror:
    | ((event: { preventDefault?(): void }) => void)
    | null;
  postMessage(
    message: StudioLayerLiftMaskWorkerRunMessage,
    transfer: Transferable[],
  ): void;
  terminate(): void;
}

export type StudioLayerLiftMaskWorkerFactory =
  () => StudioLayerLiftMaskWorkerLike | null;

export interface StudioLayerLiftMaskWorkerClientOptions {
  readonly workerFactory?: StudioLayerLiftMaskWorkerFactory | null;
  readonly timeoutMs?: number;
}

export interface StudioLayerLiftMaskWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

interface ActiveJob {
  readonly worker: StudioLayerLiftMaskWorkerLike;
  readonly requestId: number;
  readonly epoch: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: StudioLayerLiftPreparationResult) => void;
  readonly reject: (reason: unknown) => void;
  readonly onAbort: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createStudioLayerLiftMaskModuleWorker():
  StudioLayerLiftMaskWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-layer-lift-mask.worker.ts", import.meta.url),
    {
      type: "module",
      name: "toonspectrum-layer-lift-mask",
    },
  ) as unknown as StudioLayerLiftMaskWorkerLike;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? STUDIO_LAYER_LIFT_MASK_WORKER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout)
    || timeout < 1
    || timeout > STUDIO_LAYER_LIFT_MASK_WORKER_MAX_TIMEOUT_MS
  ) {
    throw new StudioLayerLiftMaskWorkerClientError(
      "invalid-request",
      `timeoutMs must be an integer between 1 and ${
        STUDIO_LAYER_LIFT_MASK_WORKER_MAX_TIMEOUT_MS
      }.`,
    );
  }
  return timeout;
}

function abortError(message: string): Error {
  if (typeof DOMException === "function") {
    return new DOMException(message, "AbortError");
  }
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function protocolClientError(
  message: string,
): StudioLayerLiftMaskWorkerClientError {
  return new StudioLayerLiftMaskWorkerClientError(
    "worker-protocol",
    message,
  );
}

/**
 * Capacity-one, latest-request-wins client. Successful jobs reuse the warm
 * Worker. Abort, timeout, supersession, runtime failure, or protocol failure
 * terminates the realm because the synchronous core cannot cancel by row/pass.
 */
export class StudioLayerLiftMaskWorkerClient {
  readonly #workerFactory: StudioLayerLiftMaskWorkerFactory | null;
  readonly #defaultTimeoutMs: number;
  #worker: StudioLayerLiftMaskWorkerLike | null = null;
  #workerEpoch = 0;
  #active: ActiveJob | null = null;
  #disposed = false;
  #nextRequestId = 1;
  #nextEpoch = 1;

  constructor(options: StudioLayerLiftMaskWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory === undefined
      ? createStudioLayerLiftMaskModuleWorker
      : options.workerFactory;
    this.#defaultTimeoutMs = normalizeTimeout(options.timeoutMs);
  }

  get activeCount(): 0 | 1 {
    return this.#active === null ? 0 : 1;
  }

  get currentEpoch(): number {
    return this.#workerEpoch;
  }

  /**
   * On successful posting, ownership of both input buffers moves to the
   * Worker. A successful result returns four newly owned output buffers.
   */
  run(
    input: StudioLayerLiftMaskWorkerInput,
    options: StudioLayerLiftMaskWorkerRunOptions = {},
  ): Promise<StudioLayerLiftPreparationResult> {
    if (this.#disposed) {
      return Promise.reject(
        new StudioLayerLiftMaskWorkerClientError(
          "worker-disposed",
          "The layer-lift mask Worker client has been disposed.",
        ),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        abortError("The layer-lift mask request was aborted."),
      );
    }

    let request;
    let timeoutMs: number;
    try {
      request = admitStudioLayerLiftMaskWorkerInput(input);
      timeoutMs = normalizeTimeout(options.timeoutMs ?? this.#defaultTimeoutMs);
    } catch (error) {
      if (error instanceof StudioLayerLiftMaskWorkerClientError) {
        return Promise.reject(error);
      }
      if (error instanceof StudioLayerLiftMaskWorkerProtocolError) {
        return Promise.reject(
          new StudioLayerLiftMaskWorkerClientError(
            error.code,
            error.message,
          ),
        );
      }
      return Promise.reject(
        new StudioLayerLiftMaskWorkerClientError(
          "invalid-request",
          "The layer-lift mask Worker request is invalid.",
        ),
      );
    }

    if (this.#active) {
      this.#rejectActive(
        abortError(
          "The layer-lift mask request was superseded by a newer request.",
        ),
      );
    }

    let worker: StudioLayerLiftMaskWorkerLike;
    try {
      worker = this.#ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    const requestId = this.#allocateRequestId();
    const epoch = this.#workerEpoch;
    let message: StudioLayerLiftMaskWorkerRunMessage;
    try {
      message = createStudioLayerLiftMaskWorkerRunMessage(
        request,
        requestId,
        epoch,
      );
    } catch (error) {
      this.#terminateWorker(worker);
      return Promise.reject(
        error instanceof StudioLayerLiftMaskWorkerProtocolError
          ? new StudioLayerLiftMaskWorkerClientError(error.code, error.message)
          : protocolClientError(
              "The layer-lift mask request could not be serialized.",
            ),
      );
    }

    return new Promise<StudioLayerLiftPreparationResult>((resolve, reject) => {
      const active: ActiveJob = {
        worker,
        requestId,
        epoch,
        targetWidth: request.planes[1].width,
        targetHeight: request.planes[1].height,
        signal: options.signal,
        resolve,
        reject,
        timer: null,
        onAbort: () => {
          if (this.#active !== active) return;
          this.#rejectActive(
            abortError("The layer-lift mask request was aborted."),
          );
        },
      };
      this.#active = active;
      options.signal?.addEventListener("abort", active.onAbort, { once: true });
      if (options.signal?.aborted) {
        active.onAbort();
        return;
      }
      active.timer = setTimeout(() => {
        if (this.#active !== active) return;
        this.#rejectActive(
          new StudioLayerLiftMaskWorkerClientError(
            "worker-timeout",
            "The layer-lift mask Worker timed out.",
          ),
        );
      }, timeoutMs);
      try {
        worker.postMessage(
          message,
          studioLayerLiftMaskWorkerRequestTransfers(message),
        );
      } catch {
        this.#rejectActive(
          new StudioLayerLiftMaskWorkerClientError(
            "worker-post-failed",
            "The layer-lift mask request could not be transferred.",
          ),
        );
        return;
      }
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#active) {
      this.#rejectActive(
        new StudioLayerLiftMaskWorkerClientError(
          "worker-disposed",
          "The layer-lift mask Worker client was disposed.",
        ),
      );
      return;
    }
    this.#terminateWorker();
  }

  #allocateRequestId(): number {
    const requestId = this.#nextRequestId;
    this.#nextRequestId =
      requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
    return requestId;
  }

  #allocateEpoch(): number {
    const epoch = this.#nextEpoch;
    this.#nextEpoch = epoch >= Number.MAX_SAFE_INTEGER ? 1 : epoch + 1;
    return epoch;
  }

  #ensureWorker(): StudioLayerLiftMaskWorkerLike {
    if (this.#worker) return this.#worker;
    if (!this.#workerFactory) {
      throw new StudioLayerLiftMaskWorkerClientError(
        "worker-unavailable",
        "This browser does not provide the layer-lift mask Worker.",
      );
    }
    let worker: StudioLayerLiftMaskWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch {
      worker = null;
    }
    if (!worker) {
      throw new StudioLayerLiftMaskWorkerClientError(
        "worker-unavailable",
        "The layer-lift mask Worker could not be created.",
      );
    }
    const epoch = this.#allocateEpoch();
    this.#worker = worker;
    this.#workerEpoch = epoch;
    worker.onmessage = (event) => {
      this.#onMessage(worker, epoch, event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (this.#worker !== worker || this.#workerEpoch !== epoch) return;
      const active = this.#active;
      if (!active || active.worker !== worker || active.epoch !== epoch) {
        this.#terminateWorker(worker);
        return;
      }
      this.#rejectActive(
        new StudioLayerLiftMaskWorkerClientError(
          "worker-runtime",
          event.message || "The layer-lift mask Worker crashed.",
        ),
      );
    };
    worker.onmessageerror = (event) => {
      event.preventDefault?.();
      if (this.#worker !== worker || this.#workerEpoch !== epoch) return;
      if (this.#active?.worker === worker) {
        this.#rejectActive(
          protocolClientError(
            "The layer-lift mask Worker response could not be cloned.",
          ),
        );
      } else {
        this.#terminateWorker(worker);
      }
    };
    return worker;
  }

  #onMessage(
    worker: StudioLayerLiftMaskWorkerLike,
    epoch: number,
    value: unknown,
  ): void {
    if (this.#worker !== worker || this.#workerEpoch !== epoch) return;
    const active = this.#active;
    if (!active || active.worker !== worker || active.epoch !== epoch) return;
    const identity = studioLayerLiftMaskWorkerResponseIdentity(value);
    if (
      identity
      && (
        identity.requestId !== active.requestId
        || identity.epoch !== active.epoch
      )
    ) {
      return;
    }
    if (!identity || !isStudioLayerLiftMaskWorkerResponseMessage(value)) {
      this.#rejectActive(
        protocolClientError(
          "The layer-lift mask Worker returned a malformed response.",
        ),
      );
      return;
    }
    const response: StudioLayerLiftMaskWorkerResponseMessage = value;
    if (response.type === "studio-layer-lift-mask/failure") {
      this.#rejectActive(
        new StudioLayerLiftMaskWorkerClientError(
          response.code === "protocol-error"
            ? "worker-protocol"
            : "worker-runtime",
          "The layer-lift mask Worker failed closed.",
        ),
      );
      return;
    }
    if (
      (response.result.ok || response.result.empty)
      && (
        response.result.width !== active.targetWidth
        || response.result.height !== active.targetHeight
      )
    ) {
      this.#rejectActive(
        protocolClientError(
          "The layer-lift mask Worker returned dimensions from another request.",
        ),
      );
      return;
    }
    try {
      const result = decodeStudioLayerLiftMaskWorkerResult(response);
      this.#resolveActive(result);
    } catch {
      this.#rejectActive(
        protocolClientError(
          "The layer-lift mask Worker result could not be admitted.",
        ),
      );
    }
  }

  #cleanupActive(active: ActiveJob): void {
    if (active.timer !== null) clearTimeout(active.timer);
    active.signal?.removeEventListener("abort", active.onAbort);
    if (this.#active === active) this.#active = null;
  }

  #resolveActive(result: StudioLayerLiftPreparationResult): void {
    const active = this.#active;
    if (!active) return;
    this.#cleanupActive(active);
    active.resolve(result);
  }

  #rejectActive(error: unknown): void {
    const active = this.#active;
    if (!active) return;
    this.#cleanupActive(active);
    this.#terminateWorker(active.worker);
    active.reject(error);
  }

  #terminateWorker(
    expected: StudioLayerLiftMaskWorkerLike | null = this.#worker,
  ): void {
    const worker = this.#worker;
    if (!worker || (expected !== null && worker !== expected)) return;
    this.#worker = null;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    try {
      worker.terminate();
    } catch {
      // Termination is fail-closed even if a host shim reports an error.
    }
  }
}
