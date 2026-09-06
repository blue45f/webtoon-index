import {
  snapshotStudioProceduralMediaSurfaceWorkerOutboundMessageCooperatively,
  snapshotStudioProceduralMediaSurfaceWorkerRequest,
  STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
  studioProceduralMediaSurfaceRequestTransfers,
  studioProceduralMediaSurfaceWorkerFailure,
  verifyStudioProceduralMediaSurfaceWorkerPayloadIntegrity,
  type StudioProceduralMediaSurfaceWorkerAdvanceEpochMessage,
  type StudioProceduralMediaSurfaceWorkerControlReceipt,
  type StudioProceduralMediaSurfaceWorkerExecuteMessage,
  type StudioProceduralMediaSurfaceWorkerFailure,
  type StudioProceduralMediaSurfaceWorkerInboundMessage,
  type StudioProceduralMediaSurfaceWorkerOutboundMessage,
  type StudioProceduralMediaSurfaceWorkerResult,
} from "./studio-procedural-media-surface-worker-protocol";

export const STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_STARTUP_TIMEOUT_MS =
  15_000;
export const STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_OPERATION_TIMEOUT_MS =
  120_000;

interface StudioProceduralMediaSurfaceWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioProceduralMediaSurfaceWorkerErrorEvent {
  preventDefault?(): void;
}

export interface StudioProceduralMediaSurfaceWorkerLike {
  postMessage(
    message: StudioProceduralMediaSurfaceWorkerInboundMessage,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (
      event: StudioProceduralMediaSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioProceduralMediaSurfaceWorkerErrorEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (
      event: StudioProceduralMediaSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioProceduralMediaSurfaceWorkerErrorEvent,
    ) => void,
  ): void;
  terminate(): void;
}

export interface StudioProceduralMediaSurfaceWorkerClientOptions {
  readonly currentEngineEpoch: number;
  readonly workerFactory?: () => StudioProceduralMediaSurfaceWorkerLike;
  readonly startupTimeoutMilliseconds?: number;
  readonly operationTimeoutMilliseconds?: number;
}

export interface StudioProceduralMediaSurfaceWorkerClientDiagnostics {
  readonly phase: "cold" | "starting" | "ready" | "disposed";
  readonly currentEngineEpoch: number;
  readonly workerGeneration: number;
  readonly activeRequestId: number | null;
  readonly operationReserved: boolean;
  readonly lastFailure:
    | StudioProceduralMediaSurfaceWorkerFailure["reason"]
    | null;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly recipeFingerprint: string;
  readonly periodicMode: "aperiodic" | "integer-fourier-torus";
  readonly coreOriginX: number;
  readonly coreOriginY: number;
  readonly coreWidth: number;
  readonly coreHeight: number;
  readonly halo: number;
  readonly outputOriginX: number;
  readonly outputOriginY: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly resolve: (
    result: StudioProceduralMediaSurfaceWorkerResult,
  ) => void;
  readonly signal?: RuntimeAbortSignal;
  readonly abort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly verification: {
    started: boolean;
  };
}

interface RuntimeAbortSignal {
  readonly target: object;
  readonly initialAborted: boolean;
  readonly addEventListener: (
    this: object,
    type: "abort",
    listener: () => void,
    options: Readonly<{ once: true }>,
  ) => void;
  readonly removeEventListener: (
    this: object,
    type: "abort",
    listener: () => void,
  ) => void;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validTimeout(value: unknown): value is number {
  return positiveInteger(value) && value <= 600_000;
}

function snapshotRuntimeAbortSignal(
  value: unknown,
): RuntimeAbortSignal | null {
  if (
    (typeof value !== "object" && typeof value !== "function")
    || value === null
  ) return null;
  try {
    const aborted = Reflect.get(value, "aborted");
    const addEventListener = Reflect.get(value, "addEventListener");
    const removeEventListener = Reflect.get(value, "removeEventListener");
    if (
      typeof aborted !== "boolean"
      || typeof addEventListener !== "function"
      || typeof removeEventListener !== "function"
    ) return null;
    return Object.freeze({
      target: value,
      initialAborted: aborted,
      addEventListener: addEventListener as
        RuntimeAbortSignal["addEventListener"],
      removeEventListener: removeEventListener as
        RuntimeAbortSignal["removeEventListener"],
    });
  } catch {
    return null;
  }
}

function readRuntimeAbortState(
  signal: RuntimeAbortSignal,
): boolean | null {
  try {
    const aborted = Reflect.get(signal.target, "aborted");
    return typeof aborted === "boolean" ? aborted : null;
  } catch {
    return null;
  }
}

function safelyRemoveRuntimeAbortListener(
  signal: RuntimeAbortSignal,
  listener: () => void,
): void {
  try {
    signal.removeEventListener.call(signal.target, "abort", listener);
  } catch {
    // Client state is released before untrusted listener cleanup.
  }
}

function defaultWorkerFactory(): StudioProceduralMediaSurfaceWorkerLike {
  return new Worker(
    new URL("./studio-procedural-media-surface-provider.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "studio-procedural-media-surface",
    },
  );
}

function rejection(
  reason: "invalid-request" | "budget-exceeded",
): StudioProceduralMediaSurfaceWorkerResult {
  return Object.freeze({ status: "rejected", reason });
}

function controlReceipt(
  control: "release" | "advance-epoch",
  requestId: number,
  engineEpoch: number,
  released: boolean,
  workerTerminated: boolean,
): StudioProceduralMediaSurfaceWorkerControlReceipt {
  return Object.freeze({
    kind: "studio-procedural-media-surface-worker-control-receipt",
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

export class StudioProceduralMediaSurfaceWorkerClient {
  readonly #workerFactory: () => StudioProceduralMediaSurfaceWorkerLike;
  readonly #startupTimeoutMilliseconds: number;
  readonly #operationTimeoutMilliseconds: number;
  #currentEngineEpoch: number;
  #phase: StudioProceduralMediaSurfaceWorkerClientDiagnostics["phase"] =
    "cold";
  #worker: StudioProceduralMediaSurfaceWorkerLike | null = null;
  #workerGeneration = 0;
  #nextRequestId = 1;
  #active: ActiveOperation | null = null;
  #operationReserved = false;
  #readyPromise: Promise<boolean> | null = null;
  #resolveReady: ((ready: boolean) => void) | null = null;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #startupEpochRequestId: number | null = null;
  #lastFailure: StudioProceduralMediaSurfaceWorkerFailure | null = null;
  #lastFailureRevision = 0;
  #lifecycleRevision = 0;
  #provisionalWorkerTerminated = false;

  public constructor(
    options: StudioProceduralMediaSurfaceWorkerClientOptions,
  ) {
    const startupTimeoutMilliseconds =
      options.startupTimeoutMilliseconds
      ?? STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_STARTUP_TIMEOUT_MS;
    const operationTimeoutMilliseconds =
      options.operationTimeoutMilliseconds
      ?? STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_OPERATION_TIMEOUT_MS;
    if (
      !positiveInteger(options.currentEngineEpoch)
      || !validTimeout(startupTimeoutMilliseconds)
      || !validTimeout(operationTimeoutMilliseconds)
      || (
        options.workerFactory !== undefined
        && typeof options.workerFactory !== "function"
      )
    ) throw new TypeError("Procedural surface Worker options are invalid");
    this.#currentEngineEpoch = options.currentEngineEpoch;
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.#startupTimeoutMilliseconds = startupTimeoutMilliseconds;
    this.#operationTimeoutMilliseconds = operationTimeoutMilliseconds;
  }

  readonly #onMessage = (
    event: StudioProceduralMediaSurfaceWorkerMessageEvent,
  ): void => {
    const lifecycleRevision = this.#lifecycleRevision;
    const active = this.#active;
    void snapshotStudioProceduralMediaSurfaceWorkerOutboundMessageCooperatively(
      event.data,
      () =>
        this.#lifecycleRevision === lifecycleRevision
        && (
          active === null
          || this.#active === active
        ),
    ).then(
      (message) => {
        if (this.#lifecycleRevision !== lifecycleRevision) return;
        if (message === null) {
          this.#failWorker(
            "protocol-error",
            "Procedural surface Worker returned a malformed message",
          );
          return;
        }
        this.#handleMessage(message);
      },
      () => {
        if (this.#lifecycleRevision !== lifecycleRevision) return;
        this.#failWorker(
          "protocol-error",
          "Procedural surface Worker message validation failed",
        );
      },
    );
  };

  #handleMessage(
    message: StudioProceduralMediaSurfaceWorkerOutboundMessage,
  ): void {
    if (message.type === "studio-procedural-media-surface/ready") {
      if (this.#phase !== "starting" || this.#startupEpochRequestId !== null) {
        this.#failWorker(
          "protocol-error",
          "Procedural surface Worker sent an unexpected ready message",
        );
        return;
      }
      if (message.engineEpoch > this.#currentEngineEpoch) {
        this.#failWorker(
          "protocol-error",
          "Procedural surface Worker epoch is ahead of the client",
        );
        return;
      }
      if (message.engineEpoch < this.#currentEngineEpoch) {
        const requestId = this.#takeRequestId();
        this.#startupEpochRequestId = requestId;
        const advance: StudioProceduralMediaSurfaceWorkerAdvanceEpochMessage = {
          type: "studio-procedural-media-surface/advance-epoch",
          version:
            STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
          requestId,
          engineEpoch: this.#currentEngineEpoch,
        };
        try {
          this.#worker?.postMessage(advance);
        } catch {
          this.#failWorker(
            "worker-unavailable",
            "Procedural surface Worker rejected epoch initialization",
          );
        }
        return;
      }
      this.#markReady();
      return;
    }
    if (message.type === "studio-procedural-media-surface/control-result") {
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
          "Procedural surface Worker returned an unexpected control receipt",
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
        "Procedural surface Worker returned an unexpected result",
      );
      return;
    }
    if (!this.#matchesActive(message.result, active)) {
      this.#failWorker(
        "invalid-result",
        "Procedural surface Worker result does not match its request",
      );
      return;
    }
    if (message.result.status === "completed") {
      if (active.verification.started) {
        this.#failWorker(
          "protocol-error",
          "Procedural surface Worker repeated a completed result",
        );
        return;
      }
      active.verification.started = true;
      void verifyStudioProceduralMediaSurfaceWorkerPayloadIntegrity(
        message.result.receipt,
      ).then(
        (verified) => {
          if (this.#active !== active || this.#phase !== "ready") return;
          if (!verified) {
            this.#failWorker(
              "invalid-result",
              "Procedural surface Worker payload failed integrity verification",
            );
            return;
          }
          this.#settleActive(message.result);
        },
        () => {
          if (this.#active !== active || this.#phase !== "ready") return;
          this.#failWorker(
            "invalid-result",
            "Procedural surface Worker payload verification failed",
          );
        },
      );
      return;
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
        "Procedural surface provider epoch diverged from the client",
      );
      return;
    }
    this.#settleActive(message.result);
  }

  readonly #onWorkerError = (
    event: StudioProceduralMediaSurfaceWorkerErrorEvent,
  ): void => {
    event.preventDefault?.();
    this.#failWorker(
      "worker-unavailable",
      "Procedural surface Worker crashed or failed message cloning",
    );
  };

  #matchesActive(
    result: StudioProceduralMediaSurfaceWorkerResult,
    active: ActiveOperation,
  ): boolean {
    if (result.status !== "completed") return true;
    const receipt = result.receipt;
    return receipt.requestSequence === active.requestSequence
      && receipt.engineEpoch === active.engineEpoch
      && receipt.artifact.originX === active.outputOriginX
      && receipt.artifact.originY === active.outputOriginY
      && receipt.artifact.width === active.outputWidth
      && receipt.artifact.height === active.outputHeight
      && receipt.artifact.receipt.recipeFingerprint
        === active.recipeFingerprint
      && receipt.artifact.receipt.periodicMode === active.periodicMode
      && receipt.artifact.receipt.coreOrigin[0] === active.coreOriginX
      && receipt.artifact.receipt.coreOrigin[1] === active.coreOriginY
      && receipt.artifact.receipt.coreSize[0] === active.coreWidth
      && receipt.artifact.receipt.coreSize[1] === active.coreHeight
      && receipt.artifact.receipt.halo === active.halo
      && receipt.artifact.receipt.origin[0] === active.outputOriginX
      && receipt.artifact.receipt.origin[1] === active.outputOriginY
      && receipt.artifact.receipt.outputSize[0] === active.outputWidth
      && receipt.artifact.receipt.outputSize[1] === active.outputHeight
      && receipt.artifact.receipt.workUnits === active.workUnits
      && receipt.artifact.receipt.residentBytes === active.residentBytes;
  }

  #provisionalLifecycleFailure(
    detail: string,
    discardProvisionalWorker = false,
  ): StudioProceduralMediaSurfaceWorkerFailure {
    const terminated = (
      discardProvisionalWorker
      ? this.#terminateWorker()
      : false
    ) || this.#provisionalWorkerTerminated;
    this.#provisionalWorkerTerminated = false;
    if (discardProvisionalWorker) this.#resetCold();
    return this.#phase === "disposed"
      ? studioProceduralMediaSurfaceWorkerFailure(
          "disposed",
          "Procedural surface Worker client was disposed before dispatch",
          terminated,
        )
      : studioProceduralMediaSurfaceWorkerFailure(
          "aborted",
          detail,
          terminated,
        );
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
    this.#lastFailureRevision = 0;
    this.#resolveReady?.(true);
    this.#resolveReady = null;
  }

  #removeWorkerListeners(
    worker: StudioProceduralMediaSurfaceWorkerLike,
  ): void {
    worker.removeEventListener("message", this.#onMessage);
    worker.removeEventListener("error", this.#onWorkerError);
    worker.removeEventListener("messageerror", this.#onWorkerError);
  }

  #terminateWorker(): boolean {
    const worker = this.#worker;
    if (worker === null) return false;
    this.#removeWorkerListeners(worker);
    worker.terminate();
    this.#worker = null;
    return true;
  }

  #settleActive(result: StudioProceduralMediaSurfaceWorkerResult): void {
    const active = this.#active;
    if (active === null) return;
    clearTimeout(active.timer);
    this.#active = null;
    if (active.signal) {
      safelyRemoveRuntimeAbortListener(active.signal, active.abort);
    }
    active.resolve(result);
  }

  #failWorker(
    reason: StudioProceduralMediaSurfaceWorkerFailure["reason"],
    detail: string,
  ): StudioProceduralMediaSurfaceWorkerFailure {
    this.#lifecycleRevision += 1;
    const terminated = this.#terminateWorker();
    const failure = studioProceduralMediaSurfaceWorkerFailure(
      reason,
      detail,
      terminated,
    );
    this.#lastFailure = failure;
    this.#lastFailureRevision = this.#lifecycleRevision;
    this.#clearStartupTimer();
    this.#startupEpochRequestId = null;
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#settleActive(failure);
    if (this.#phase !== "disposed") this.#phase = "cold";
    return failure;
  }

  #discardProvisionalWorker(
    worker: StudioProceduralMediaSurfaceWorkerLike,
  ): void {
    if (this.#worker === worker) this.#worker = null;
    this.#removeWorkerListeners(worker);
    worker.terminate();
    this.#provisionalWorkerTerminated = true;
  }

  #ensureReady(expectedLifecycleRevision: number): Promise<boolean> {
    if (this.#lifecycleRevision !== expectedLifecycleRevision) {
      return Promise.resolve(false);
    }
    if (this.#phase === "ready") return Promise.resolve(true);
    if (this.#phase === "disposed") return Promise.resolve(false);
    if (this.#readyPromise !== null) return this.#readyPromise;
    this.#phase = "starting";
    const readyPromise = new Promise<boolean>((resolve) => {
      this.#resolveReady = resolve;
    });
    this.#readyPromise = readyPromise;
    try {
      const worker = this.#workerFactory();
      if (
        this.#lifecycleRevision !== expectedLifecycleRevision
        || this.#phase !== "starting"
        || this.#readyPromise !== readyPromise
      ) {
        this.#discardProvisionalWorker(worker);
        return readyPromise;
      }
      this.#worker = worker;
      this.#workerGeneration += 1;
      worker.addEventListener("message", this.#onMessage);
      if (
        this.#lifecycleRevision !== expectedLifecycleRevision
        || this.#phase !== "starting"
        || this.#readyPromise !== readyPromise
      ) {
        this.#discardProvisionalWorker(worker);
        return readyPromise;
      }
      worker.addEventListener("error", this.#onWorkerError);
      if (
        this.#lifecycleRevision !== expectedLifecycleRevision
        || this.#phase !== "starting"
        || this.#readyPromise !== readyPromise
      ) {
        this.#discardProvisionalWorker(worker);
        return readyPromise;
      }
      worker.addEventListener("messageerror", this.#onWorkerError);
      if (
        this.#lifecycleRevision !== expectedLifecycleRevision
        || this.#phase !== "starting"
        || this.#readyPromise !== readyPromise
      ) {
        this.#discardProvisionalWorker(worker);
        return readyPromise;
      }
    } catch {
      this.#failWorker(
        "worker-unavailable",
        "Procedural surface Worker construction failed",
      );
      return readyPromise;
    }
    this.#startupTimer = setTimeout(() => {
      this.#failWorker(
        "startup-timeout",
        "Procedural surface Worker startup timed out",
      );
    }, this.#startupTimeoutMilliseconds);
    return readyPromise;
  }

  async #waitUntilReady(
    signal: RuntimeAbortSignal | undefined,
    expectedLifecycleRevision: number,
  ): Promise<"aborted" | "invalid" | "ready" | "stale" | "unavailable"> {
    const ready = this.#ensureReady(expectedLifecycleRevision);
    if (signal === undefined) {
      const available = await ready;
      return (
        this.#lifecycleRevision !== expectedLifecycleRevision
        && this.#lastFailureRevision !== this.#lifecycleRevision
      )
        ? "stale"
        : available ? "ready" : "unavailable";
    }
    if (signal.initialAborted) {
      this.#failWorker(
        "aborted",
        "Procedural surface Worker startup was cancelled",
      );
      return "aborted";
    }
    const currentState = readRuntimeAbortState(signal);
    if (currentState === null) return "invalid";
    if (currentState) {
      this.#failWorker(
        "aborted",
        "Procedural surface Worker startup was cancelled",
      );
      return "aborted";
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        result: "aborted" | "invalid" | "ready" | "stale" | "unavailable",
      ): void => {
        if (settled) return;
        settled = true;
        safelyRemoveRuntimeAbortListener(signal, abort);
        if (result === "aborted") {
          this.#failWorker(
            "aborted",
            "Procedural surface Worker startup was cancelled",
          );
        }
        resolve(result);
      };
      const abort = (): void => {
        finish("aborted");
      };
      try {
        signal.addEventListener.call(
          signal.target,
          "abort",
          abort,
          { once: true },
        );
        if (settled) return;
        const aborted = readRuntimeAbortState(signal);
        if (aborted === null) {
          finish("invalid");
          return;
        }
        if (aborted) {
          finish("aborted");
          return;
        }
      } catch {
        finish("invalid");
        return;
      }
      void ready.then(
        (value) => finish(
          (
            this.#lifecycleRevision !== expectedLifecycleRevision
            && this.#lastFailureRevision !== this.#lifecycleRevision
          )
            ? "stale"
            : value ? "ready" : "unavailable",
        ),
        () => finish("unavailable"),
      );
    });
  }

  public async render(
    candidate: unknown,
    signal?: AbortSignal,
  ): Promise<StudioProceduralMediaSurfaceWorkerResult> {
    if (this.#phase === "disposed") {
      return studioProceduralMediaSurfaceWorkerFailure(
        "disposed",
        "Procedural surface Worker client is disposed",
      );
    }
    if (this.#operationReserved || this.#active !== null) {
      return studioProceduralMediaSurfaceWorkerFailure(
        "backpressure",
        "Procedural surface Worker allows one active operation",
      );
    }
    this.#operationReserved = true;
    this.#provisionalWorkerTerminated = false;
    const lifecycleRevision = this.#lifecycleRevision;
    let setupSignal: RuntimeAbortSignal | null = null;
    let setupAbort: (() => void) | null = null;
    let setupListenerOwned = false;
    try {
      const runtimeSignal = signal === undefined
        ? undefined
        : snapshotRuntimeAbortSignal(signal);
      if (runtimeSignal === null) return rejection("invalid-request");
      if (runtimeSignal?.initialAborted) {
        return this.#failWorker(
          "aborted",
          "Procedural surface request was already cancelled",
        );
      }
      let snapshot: ReturnType<
        typeof snapshotStudioProceduralMediaSurfaceWorkerRequest
      >;
      try {
        snapshot =
          snapshotStudioProceduralMediaSurfaceWorkerRequest(candidate);
      } catch {
        return rejection("invalid-request");
      }
      if (!snapshot.ok) return rejection(snapshot.reason);
      if (snapshot.request.engineEpoch !== this.#currentEngineEpoch) {
        return rejection("invalid-request");
      }
      if (this.#lifecycleRevision !== lifecycleRevision) {
        return this.#provisionalLifecycleFailure(
          "Procedural surface Worker lifecycle changed before readiness",
        );
      }
      const readiness = await this.#waitUntilReady(
        runtimeSignal,
        lifecycleRevision,
      );
      if (readiness !== "ready") {
        return readiness === "aborted"
          ? this.#lastFailure ?? studioProceduralMediaSurfaceWorkerFailure(
              "aborted",
              "Procedural surface request was cancelled",
              true,
            )
          : readiness === "stale"
            ? this.#provisionalLifecycleFailure(
                "Procedural surface Worker lifecycle changed during readiness",
                true,
              )
          : readiness === "invalid"
            ? rejection("invalid-request")
          : this.#lastFailure ?? studioProceduralMediaSurfaceWorkerFailure(
              "worker-unavailable",
              "Procedural surface Worker is unavailable",
            );
      }
      if (
        this.#lifecycleRevision !== lifecycleRevision
        || this.#phase !== "ready"
        || this.#worker === null
        || snapshot.request.engineEpoch !== this.#currentEngineEpoch
      ) {
        return this.#provisionalLifecycleFailure(
          "Procedural surface Worker lifecycle changed before dispatch",
          true,
        );
      }
      const abortedBeforeDispatch = runtimeSignal === undefined
        ? false
        : readRuntimeAbortState(runtimeSignal);
      if (abortedBeforeDispatch === null) return rejection("invalid-request");
      if (abortedBeforeDispatch) {
        return this.#failWorker(
          "aborted",
          "Procedural surface request was cancelled before dispatch",
        );
      }
      let abortedDuringSetup = false;
      let activeReference: ActiveOperation | null = null;
      const abort = (): void => {
        abortedDuringSetup = true;
        if (
          activeReference !== null
          && this.#active === activeReference
        ) {
          this.#failWorker(
            "aborted",
            "Procedural surface Worker operation was cancelled",
          );
        }
      };
      if (runtimeSignal) {
        setupSignal = runtimeSignal;
        setupAbort = abort;
        setupListenerOwned = true;
        try {
          runtimeSignal.addEventListener.call(
            runtimeSignal.target,
            "abort",
            abort,
            { once: true },
          );
          const aborted = readRuntimeAbortState(runtimeSignal);
          if (aborted === null) return rejection("invalid-request");
          abortedDuringSetup ||= aborted;
        } catch {
          return rejection("invalid-request");
        }
        if (abortedDuringSetup) {
          return this.#failWorker(
            "aborted",
            "Procedural surface Worker operation was cancelled",
          );
        }
      }
      if (
        this.#lifecycleRevision !== lifecycleRevision
        || this.#phase !== "ready"
        || this.#worker === null
        || snapshot.request.engineEpoch !== this.#currentEngineEpoch
      ) {
        return this.#provisionalLifecycleFailure(
          "Procedural surface Worker lifecycle changed during admission",
          true,
        );
      }
      const requestId = this.#takeRequestId();
      const message: StudioProceduralMediaSurfaceWorkerExecuteMessage = {
        type: "studio-procedural-media-surface/execute",
        version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
        requestId,
        request: snapshot.request,
      };
      let resolveOperation:
        | ((result: StudioProceduralMediaSurfaceWorkerResult) => void)
        | null = null;
      const resultPromise =
        new Promise<StudioProceduralMediaSurfaceWorkerResult>((resolve) => {
          resolveOperation = resolve;
        });
      const timer = setTimeout(() => {
        this.#failWorker(
          "operation-timeout",
          "Procedural surface Worker operation timed out",
        );
      }, this.#operationTimeoutMilliseconds);
      if (resolveOperation === null) {
        clearTimeout(timer);
        return rejection("invalid-request");
      }
      const active: ActiveOperation = Object.freeze({
        requestId,
        requestSequence: snapshot.request.requestSequence,
        engineEpoch: snapshot.request.engineEpoch,
        recipeFingerprint: snapshot.request.recipe.fingerprint,
        periodicMode: snapshot.request.recipe.seamlessPeriodEnabled
          ? "integer-fourier-torus"
          : "aperiodic",
        coreOriginX: snapshot.request.region.originX,
        coreOriginY: snapshot.request.region.originY,
        coreWidth: snapshot.request.region.width,
        coreHeight: snapshot.request.region.height,
        halo: snapshot.request.region.halo,
        outputOriginX:
          snapshot.request.region.originX - snapshot.request.region.halo,
        outputOriginY:
          snapshot.request.region.originY - snapshot.request.region.halo,
        outputWidth:
          snapshot.request.region.width
          + snapshot.request.region.halo * 2,
        outputHeight:
          snapshot.request.region.height
          + snapshot.request.region.halo * 2,
        workUnits:
          (
            snapshot.request.region.width
            + snapshot.request.region.halo * 2
          )
          * (
            snapshot.request.region.height
            + snapshot.request.region.halo * 2
          )
          * (snapshot.request.recipe.relief.octaves * 8 + 84)
          * 5,
        residentBytes:
          (
            snapshot.request.region.width
            + snapshot.request.region.halo * 2
          )
          * (
            snapshot.request.region.height
            + snapshot.request.region.halo * 2
          )
          * 7
          * Float32Array.BYTES_PER_ELEMENT,
        resolve: resolveOperation,
        ...(runtimeSignal === undefined ? {} : { signal: runtimeSignal }),
        abort,
        timer,
        verification: { started: false },
      });
      activeReference = active;
      this.#active = active;
      setupListenerOwned = false;
      if (abortedDuringSetup) {
        abort();
        return resultPromise;
      }
      try {
        this.#worker?.postMessage(
          message,
          studioProceduralMediaSurfaceRequestTransfers(message),
        );
      } catch {
        this.#failWorker(
          "worker-unavailable",
          "Procedural surface Worker rejected request transfer",
        );
      }
      return resultPromise;
    } finally {
      if (
        setupListenerOwned
        && setupSignal !== null
        && setupAbort !== null
      ) safelyRemoveRuntimeAbortListener(setupSignal, setupAbort);
      this.#operationReserved = false;
    }
  }

  public release(): StudioProceduralMediaSurfaceWorkerControlReceipt {
    this.#lifecycleRevision += 1;
    const requestId = this.#takeRequestId();
    const terminated = this.#terminateWorker();
    if (this.#active !== null) {
      this.#settleActive(studioProceduralMediaSurfaceWorkerFailure(
        "aborted",
        "Procedural surface Worker was terminated for release",
        terminated,
      ));
    }
    this.#resetCold();
    return controlReceipt(
      "release",
      requestId,
      this.#currentEngineEpoch,
      terminated,
      terminated,
    );
  }

  public advanceEngineEpoch(
    nextEpoch: number,
  ): StudioProceduralMediaSurfaceWorkerControlReceipt {
    this.#lifecycleRevision += 1;
    const requestId = this.#takeRequestId();
    const accepted =
      positiveInteger(nextEpoch)
      && nextEpoch > this.#currentEngineEpoch;
    const terminated = this.#terminateWorker();
    if (this.#active !== null) {
      this.#settleActive(studioProceduralMediaSurfaceWorkerFailure(
        "aborted",
        "Procedural surface Worker was terminated for an epoch transition",
        terminated,
      ));
    }
    this.#resetCold();
    if (accepted) this.#currentEngineEpoch = nextEpoch;
    return controlReceipt(
      "advance-epoch",
      requestId,
      this.#currentEngineEpoch,
      accepted,
      terminated,
    );
  }

  #resetCold(): void {
    this.#clearStartupTimer();
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#startupEpochRequestId = null;
    if (this.#phase !== "disposed") this.#phase = "cold";
  }

  public getDiagnostics(): StudioProceduralMediaSurfaceWorkerClientDiagnostics {
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
    this.#lifecycleRevision += 1;
    this.#phase = "disposed";
    const terminated = this.#terminateWorker();
    if (this.#active !== null) {
      this.#settleActive(studioProceduralMediaSurfaceWorkerFailure(
        "disposed",
        "Procedural surface Worker client was disposed",
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

export function createStudioProceduralMediaSurfaceWorkerClient(
  options: StudioProceduralMediaSurfaceWorkerClientOptions,
): StudioProceduralMediaSurfaceWorkerClient {
  return new StudioProceduralMediaSurfaceWorkerClient(options);
}
