import {
  snapshotStudioFiberBristleWorkerOutboundMessage,
  snapshotStudioFiberBristleWorkerRequest,
  STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
  studioFiberBristleRequestTransfers,
  studioFiberBristleWorkerRequestFlowHash,
  studioFiberBristleWorkerFailure,
  type StudioFiberBristleWorkerAdvanceEpochMessage,
  type StudioFiberBristleWorkerBoundaryFailure,
  type StudioFiberBristleWorkerControlReceipt,
  type StudioFiberBristleWorkerExecuteMessage,
  type StudioFiberBristleWorkerInboundMessage,
  type StudioFiberBristleWorkerResult,
} from "./studio-fiber-bristle-brush-worker-protocol";

export const STUDIO_FIBER_BRISTLE_WORKER_STARTUP_TIMEOUT_MS = 15_000;
export const STUDIO_FIBER_BRISTLE_WORKER_OPERATION_TIMEOUT_MS = 120_000;

interface StudioFiberBristleWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioFiberBristleWorkerErrorEvent {
  preventDefault?(): void;
}

export interface StudioFiberBristleWorkerLike {
  postMessage(
    message: StudioFiberBristleWorkerInboundMessage,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: StudioFiberBristleWorkerMessageEvent) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: StudioFiberBristleWorkerErrorEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: StudioFiberBristleWorkerMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: StudioFiberBristleWorkerErrorEvent) => void,
  ): void;
  terminate(): void;
}

export interface StudioFiberBristleWorkerClientOptions {
  readonly currentEngineEpoch: number;
  readonly workerFactory?: () => StudioFiberBristleWorkerLike;
  readonly startupTimeoutMilliseconds?: number;
  readonly operationTimeoutMilliseconds?: number;
}

export interface StudioFiberBristleWorkerClientDiagnostics {
  readonly phase: "cold" | "starting" | "ready" | "disposed";
  readonly currentEngineEpoch: number;
  readonly workerGeneration: number;
  readonly activeRequestId: number | null;
  readonly operationReserved: boolean;
  readonly lastFailure:
    | StudioFiberBristleWorkerBoundaryFailure["reason"]
    | null;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly strokeId: string;
  readonly operation: "replace" | "append";
  readonly recipeFingerprint: string;
  readonly fiberCount: number;
  readonly requestFlowHash: `sha256:${string}`;
  readonly resolve: (result: StudioFiberBristleWorkerResult) => void;
  readonly signal?: AbortSignal;
  readonly abort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validTimeout(value: unknown): value is number {
  return positiveInteger(value) && value <= 600_000;
}

function defaultWorkerFactory(): StudioFiberBristleWorkerLike {
  return new Worker(
    new URL("./studio-fiber-bristle-brush-provider.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "studio-fiber-bristle-brush",
    },
  );
}

function invalidRequest(
  reason: "invalid-request" | "budget-exceeded",
): StudioFiberBristleWorkerResult {
  return Object.freeze({ status: "rejected", reason });
}

function controlReceipt(
  control: "release" | "advance-epoch",
  requestId: number,
  engineEpoch: number,
  released: boolean,
  workerTerminated: boolean,
): StudioFiberBristleWorkerControlReceipt {
  return Object.freeze({
    kind: "studio-fiber-bristle-worker-control-receipt",
    control,
    requestId,
    engineEpoch,
    released,
    execution: "dedicated-worker",
    mainThreadComputationFallback: false,
    workerTerminated,
    complete: true,
  });
}

function nativeAbortState(signal: AbortSignal): boolean | null {
  try {
    const getter = Object.getOwnPropertyDescriptor(
      AbortSignal.prototype,
      "aborted",
    )?.get;
    return getter ? Boolean(getter.call(signal)) : null;
  } catch {
    return null;
  }
}

function addAbortListener(signal: AbortSignal, listener: () => void): boolean {
  try {
    EventTarget.prototype.addEventListener.call(
      signal,
      "abort",
      listener,
      { once: true },
    );
    return true;
  } catch {
    return false;
  }
}

function removeAbortListener(signal: AbortSignal, listener: () => void): void {
  try {
    EventTarget.prototype.removeEventListener.call(signal, "abort", listener);
  } catch {
    // A hostile signal cannot prevent deterministic local settlement.
  }
}

export class StudioFiberBristleWorkerClient {
  readonly #workerFactory: () => StudioFiberBristleWorkerLike;
  readonly #startupTimeoutMilliseconds: number;
  readonly #operationTimeoutMilliseconds: number;
  #currentEngineEpoch: number;
  #phase: StudioFiberBristleWorkerClientDiagnostics["phase"] = "cold";
  #worker: StudioFiberBristleWorkerLike | null = null;
  #workerGeneration = 0;
  #nextRequestId = 1;
  #active: ActiveOperation | null = null;
  #operationReserved = false;
  #readyPromise: Promise<boolean> | null = null;
  #resolveReady: ((ready: boolean) => void) | null = null;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #startupEpochRequestId: number | null = null;
  #lastFailure: StudioFiberBristleWorkerBoundaryFailure | null = null;
  readonly #strokeReplayHashes = new Map<string, `sha256:${string}`>();

  public constructor(options: StudioFiberBristleWorkerClientOptions) {
    const startupTimeoutMilliseconds =
      options.startupTimeoutMilliseconds
      ?? STUDIO_FIBER_BRISTLE_WORKER_STARTUP_TIMEOUT_MS;
    const operationTimeoutMilliseconds =
      options.operationTimeoutMilliseconds
      ?? STUDIO_FIBER_BRISTLE_WORKER_OPERATION_TIMEOUT_MS;
    if (
      !positiveInteger(options.currentEngineEpoch)
      || !validTimeout(startupTimeoutMilliseconds)
      || !validTimeout(operationTimeoutMilliseconds)
      || (
        options.workerFactory !== undefined
        && typeof options.workerFactory !== "function"
      )
    ) throw new TypeError("Fiber bristle Worker client options are invalid");
    this.#currentEngineEpoch = options.currentEngineEpoch;
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.#startupTimeoutMilliseconds = startupTimeoutMilliseconds;
    this.#operationTimeoutMilliseconds = operationTimeoutMilliseconds;
  }

  #isDisposed(): boolean {
    return this.#phase === "disposed";
  }

  readonly #onMessage = (
    event: StudioFiberBristleWorkerMessageEvent,
  ): void => {
    const message = snapshotStudioFiberBristleWorkerOutboundMessage(
      event.data,
    );
    if (message === null) {
      this.#failWorker(
        "protocol-error",
        "Fiber bristle Worker returned a malformed message",
      );
      return;
    }
    if (message.type === "studio-fiber-bristle/ready") {
      if (this.#phase !== "starting" || this.#startupEpochRequestId !== null) {
        this.#failWorker(
          "protocol-error",
          "Fiber bristle Worker sent an unexpected ready message",
        );
        return;
      }
      if (message.engineEpoch > this.#currentEngineEpoch) {
        this.#failWorker(
          "protocol-error",
          "Fiber bristle Worker epoch is ahead of the client",
        );
        return;
      }
      if (message.engineEpoch < this.#currentEngineEpoch) {
        const requestId = this.#takeRequestId();
        this.#startupEpochRequestId = requestId;
        const advance: StudioFiberBristleWorkerAdvanceEpochMessage = {
          type: "studio-fiber-bristle/advance-epoch",
          version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
          requestId,
          engineEpoch: this.#currentEngineEpoch,
        };
        try {
          this.#worker?.postMessage(advance);
        } catch {
          this.#failWorker(
            "worker-unavailable",
            "Fiber bristle Worker rejected epoch initialization",
          );
        }
        return;
      }
      this.#markReady();
      return;
    }
    if (message.type === "studio-fiber-bristle/control-result") {
      if (
        this.#phase !== "starting"
        || this.#startupEpochRequestId === null
        || message.receipt.requestId !== this.#startupEpochRequestId
        || message.receipt.control !== "advance-epoch"
        || message.receipt.engineEpoch !== this.#currentEngineEpoch
        || !message.receipt.released
      ) {
        this.#failWorker(
          "protocol-error",
          "Fiber bristle Worker returned an unexpected control receipt",
        );
        return;
      }
      this.#startupEpochRequestId = null;
      this.#markReady();
      return;
    }
    const active = this.#active;
    if (
      this.#phase !== "ready"
      || active === null
      || message.requestId !== active.requestId
      || message.requestSequence !== active.requestSequence
      || message.engineEpoch !== active.engineEpoch
    ) {
      this.#failWorker(
        "protocol-error",
        "Fiber bristle Worker returned an unexpected result",
      );
      return;
    }
    if (!this.#matchesActive(message.result, active)) {
      this.#failWorker(
        "invalid-result",
        "Fiber bristle Worker result does not match the active request",
      );
      return;
    }
    if (message.result.status === "completed") {
      this.#strokeReplayHashes.set(
        active.strokeId,
        message.result.receipt.artifact.receipt.replayHash,
      );
    }
    if (
      message.result.status === "worker-failed"
      && message.result.reason !== "backpressure"
    ) {
      this.#failWorker(message.result.reason, message.result.detail);
      return;
    }
    if (
      message.result.status === "rejected"
      && message.result.reason === "engine-epoch"
    ) {
      this.#failWorker(
        "protocol-error",
        "Fiber bristle Worker provider epoch diverged from the client",
      );
      return;
    }
    this.#settleActive(message.result);
  };

  readonly #onWorkerError = (
    event: StudioFiberBristleWorkerErrorEvent,
  ): void => {
    event.preventDefault?.();
    this.#failWorker(
      "worker-unavailable",
      "Fiber bristle Worker crashed or failed message cloning",
    );
  };

  #matchesActive(
    result: StudioFiberBristleWorkerResult,
    active: ActiveOperation,
  ): boolean {
    if (result.status !== "completed") return true;
    const receipt = result.receipt;
    return receipt.requestSequence === active.requestSequence
      && receipt.engineEpoch === active.engineEpoch
      && receipt.strokeId === active.strokeId
      && receipt.operation === active.operation
      && receipt.requestFlowHash === active.requestFlowHash
      && receipt.artifact.receipt.recipeFingerprint
        === active.recipeFingerprint
      && receipt.artifact.receipt.fiberCount === active.fiberCount;
  }

  #takeRequestId(): number {
    if (this.#nextRequestId >= Number.MAX_SAFE_INTEGER) {
      this.#nextRequestId = 1;
    }
    const value = this.#nextRequestId;
    this.#nextRequestId += 1;
    return value;
  }

  #clearStartupTimer(): void {
    if (this.#startupTimer !== null) {
      clearTimeout(this.#startupTimer);
      this.#startupTimer = null;
    }
  }

  #markReady(): void {
    this.#clearStartupTimer();
    this.#phase = "ready";
    this.#lastFailure = null;
    this.#resolveReady?.(true);
    this.#resolveReady = null;
  }

  #removeWorkerListeners(worker: StudioFiberBristleWorkerLike): void {
    worker.removeEventListener("message", this.#onMessage);
    worker.removeEventListener("error", this.#onWorkerError);
    worker.removeEventListener("messageerror", this.#onWorkerError);
  }

  #terminateWorker(): boolean {
    const worker = this.#worker;
    this.#strokeReplayHashes.clear();
    if (worker === null) return false;
    this.#worker = null;
    try {
      this.#removeWorkerListeners(worker);
      worker.terminate();
    } catch {
      // A hostile WorkerLike cannot prevent deterministic local settlement.
    }
    return true;
  }

  #settleActive(result: StudioFiberBristleWorkerResult): void {
    const active = this.#active;
    if (active === null) return;
    clearTimeout(active.timer);
    if (active.signal) removeAbortListener(active.signal, active.abort);
    this.#active = null;
    active.resolve(result);
  }

  #failWorker(
    reason: StudioFiberBristleWorkerBoundaryFailure["reason"],
    detail: string,
  ): StudioFiberBristleWorkerBoundaryFailure {
    const terminated = this.#terminateWorker();
    const failure = studioFiberBristleWorkerFailure(
      reason,
      detail,
      terminated,
    );
    this.#lastFailure = failure;
    this.#clearStartupTimer();
    this.#startupEpochRequestId = null;
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#settleActive(failure);
    if (this.#phase !== "disposed") this.#phase = "cold";
    return failure;
  }

  #ensureReady(): Promise<boolean> {
    if (this.#phase === "ready") return Promise.resolve(true);
    if (this.#phase === "disposed") return Promise.resolve(false);
    if (this.#readyPromise !== null) return this.#readyPromise;

    this.#phase = "starting";
    const readiness = new Promise<boolean>((resolve) => {
      this.#resolveReady = resolve;
    });
    this.#readyPromise = readiness;
    try {
      const worker = this.#workerFactory();
      if (this.#isDisposed()) {
        let workerTerminated = false;
        try {
          worker.terminate();
          workerTerminated = true;
        } catch {
          // Disposal remains authoritative.
        }
        this.#lastFailure = studioFiberBristleWorkerFailure(
          "disposed",
          "Fiber bristle Worker client was disposed during construction",
          workerTerminated,
        );
        return readiness;
      }
      this.#worker = worker;
      this.#workerGeneration += 1;
      worker.addEventListener("message", this.#onMessage);
      worker.addEventListener("error", this.#onWorkerError);
      worker.addEventListener("messageerror", this.#onWorkerError);
    } catch {
      this.#failWorker(
        "worker-unavailable",
        "Fiber bristle Worker construction failed",
      );
      return readiness;
    }
    if (this.#phase === "starting") this.#startupTimer = setTimeout(() => {
      this.#failWorker(
        "startup-timeout",
        "Fiber bristle Worker startup timed out",
      );
    }, this.#startupTimeoutMilliseconds);
    return readiness;
  }

  async #waitUntilReady(
    signal: AbortSignal | undefined,
  ): Promise<"aborted" | "ready" | "unavailable"> {
    const ready = this.#ensureReady();
    if (signal === undefined) {
      return (await ready) ? "ready" : "unavailable";
    }
    if (nativeAbortState(signal) !== false) return "aborted";
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        value: "aborted" | "ready" | "unavailable",
      ): void => {
        if (settled) return;
        settled = true;
        removeAbortListener(signal, abort);
        resolve(value);
      };
      const abort = (): void => {
        this.#failWorker(
          "aborted",
          "Fiber bristle Worker startup was cancelled",
        );
        finish("aborted");
      };
      if (!addAbortListener(signal, abort)) {
        this.#failWorker(
          "aborted",
          "Fiber bristle Worker signal listener registration failed",
        );
        finish("aborted");
        return;
      }
      void ready.then(
        (value) => finish(value ? "ready" : "unavailable"),
        () => finish("unavailable"),
      );
    });
  }

  public async render(
    candidate: unknown,
    signal?: AbortSignal,
  ): Promise<StudioFiberBristleWorkerResult> {
    if (this.#phase === "disposed") {
      return studioFiberBristleWorkerFailure(
        "disposed",
        "Fiber bristle Worker client is disposed",
      );
    }
    if (this.#operationReserved || this.#active !== null) {
      return studioFiberBristleWorkerFailure(
        "backpressure",
        "Fiber bristle Worker allows one active operation",
      );
    }
    this.#operationReserved = true;
    try {
      if (
      signal !== undefined
      && (
        typeof AbortSignal === "undefined"
        || !(signal instanceof AbortSignal)
        || nativeAbortState(signal) === null
      )
    ) return invalidRequest("invalid-request");
    if (signal && nativeAbortState(signal)) {
      return this.#failWorker(
        "aborted",
        "Fiber bristle Worker request was already cancelled",
      );
    }
    const snapshot = snapshotStudioFiberBristleWorkerRequest(candidate);
    if (!snapshot.ok) return invalidRequest(snapshot.reason);
    if (snapshot.request.engineEpoch !== this.#currentEngineEpoch) {
      return invalidRequest("invalid-request");
    }

    const readiness = await this.#waitUntilReady(signal);
    if (readiness !== "ready") {
      if (this.#isDisposed()) {
        return this.#lastFailure?.reason === "disposed"
          ? this.#lastFailure
          : studioFiberBristleWorkerFailure(
              "disposed",
              "Fiber bristle Worker client was disposed during startup",
            );
      }
      return readiness === "aborted"
        ? this.#lastFailure ?? studioFiberBristleWorkerFailure(
            "aborted",
            "Fiber bristle Worker request was cancelled",
            true,
          )
        : this.#lastFailure ?? studioFiberBristleWorkerFailure(
            "worker-unavailable",
            "Fiber bristle Worker is unavailable",
          );
    }
    if (signal && nativeAbortState(signal) !== false) {
      return this.#failWorker(
        "aborted",
        "Fiber bristle Worker request was cancelled before dispatch",
      );
    }

    const requestId = this.#takeRequestId();
    const message: StudioFiberBristleWorkerExecuteMessage = {
      type: "studio-fiber-bristle/execute",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId,
      request: snapshot.request,
    };
    const previousReplayHash = snapshot.request.operation === "append"
      ? this.#strokeReplayHashes.get(snapshot.request.strokeId) ?? null
      : null;
    const requestFlowHash = studioFiberBristleWorkerRequestFlowHash(
      snapshot.request,
      previousReplayHash,
    );
    return await new Promise((resolve) => {
      const abort = (): void => {
        this.#failWorker(
          "aborted",
          "Fiber bristle Worker operation was cancelled",
        );
      };
      const timer = setTimeout(() => {
        this.#failWorker(
          "operation-timeout",
          "Fiber bristle Worker operation timed out",
        );
      }, this.#operationTimeoutMilliseconds);
      this.#active = Object.freeze({
        requestId,
        requestSequence: snapshot.request.requestSequence,
        engineEpoch: snapshot.request.engineEpoch,
        strokeId: snapshot.request.strokeId,
        operation: snapshot.request.operation,
        recipeFingerprint: snapshot.request.recipe.fingerprint,
        fiberCount: snapshot.request.recipe.fiberCount,
        requestFlowHash,
        resolve,
        ...(signal === undefined ? {} : { signal }),
        abort,
        timer,
      });
      if (signal && !addAbortListener(signal, abort)) {
        this.#failWorker(
          "aborted",
          "Fiber bristle Worker signal listener registration failed",
        );
        return;
      }
      try {
        this.#worker?.postMessage(
          message,
          studioFiberBristleRequestTransfers(message),
        );
      } catch {
        this.#failWorker(
          "worker-unavailable",
          "Fiber bristle Worker rejected request transfer",
        );
      }
    });
    } finally {
      this.#operationReserved = false;
    }
  }

  public releaseStroke(
    strokeId: string,
  ): StudioFiberBristleWorkerControlReceipt {
    const requestId = this.#takeRequestId();
    const valid =
      typeof strokeId === "string"
      && strokeId.length > 0
      && strokeId.length <= 192;
    if (!valid) {
      return controlReceipt(
        "release",
        requestId,
        this.#currentEngineEpoch,
        false,
        false,
      );
    }
    const terminated = this.#terminateWorker();
    if (this.#active !== null) {
      this.#settleActive(studioFiberBristleWorkerFailure(
        "aborted",
        "Fiber bristle Worker was terminated to release retained state",
        terminated,
      ));
    }
    this.#clearStartupTimer();
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#startupEpochRequestId = null;
    if (this.#phase !== "disposed") this.#phase = "cold";
    return controlReceipt(
      "release",
      requestId,
      this.#currentEngineEpoch,
      valid && terminated,
      terminated,
    );
  }

  public advanceEngineEpoch(
    nextEpoch: number,
  ): StudioFiberBristleWorkerControlReceipt {
    const requestId = this.#takeRequestId();
    const accepted =
      positiveInteger(nextEpoch)
      && nextEpoch > this.#currentEngineEpoch;
    if (!accepted) {
      return controlReceipt(
        "advance-epoch",
        requestId,
        this.#currentEngineEpoch,
        false,
        false,
      );
    }
    const terminated = this.#terminateWorker();
    if (this.#active !== null) {
      this.#settleActive(studioFiberBristleWorkerFailure(
        "aborted",
        "Fiber bristle Worker was terminated for an epoch transition",
        terminated,
      ));
    }
    this.#clearStartupTimer();
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#startupEpochRequestId = null;
    if (accepted) this.#currentEngineEpoch = nextEpoch;
    if (this.#phase !== "disposed") this.#phase = "cold";
    return controlReceipt(
      "advance-epoch",
      requestId,
      this.#currentEngineEpoch,
      accepted,
      terminated,
    );
  }

  public getDiagnostics(): StudioFiberBristleWorkerClientDiagnostics {
    return Object.freeze({
      phase: this.#phase,
      currentEngineEpoch: this.#currentEngineEpoch,
      workerGeneration: this.#workerGeneration,
      activeRequestId: this.#active?.requestId ?? null,
      operationReserved: this.#operationReserved,
      lastFailure: this.#lastFailure?.reason ?? null,
    });
  }

  public dispose(): void {
    if (this.#phase === "disposed") return;
    this.#phase = "disposed";
    const terminated = this.#terminateWorker();
    if (this.#active !== null) {
      this.#settleActive(studioFiberBristleWorkerFailure(
        "disposed",
        "Fiber bristle Worker client was disposed",
        terminated,
      ));
    }
    this.#clearStartupTimer();
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#startupEpochRequestId = null;
  }
}

export function createStudioFiberBristleWorkerClient(
  options: StudioFiberBristleWorkerClientOptions,
): StudioFiberBristleWorkerClient {
  return new StudioFiberBristleWorkerClient(options);
}
