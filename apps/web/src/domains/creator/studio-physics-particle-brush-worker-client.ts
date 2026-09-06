import {
  snapshotStudioPhysicsParticleWorkerOutboundMessageCooperatively,
  snapshotStudioPhysicsParticleWorkerRequestCooperatively,
  STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS,
  STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
  studioPhysicsParticleWorkerFailure,
  studioPhysicsParticleWorkerRequestTransfers,
  type StudioPhysicsParticleWorkerAdvanceEpochMessage,
  type StudioPhysicsParticleWorkerBoundaryFailure,
  type StudioPhysicsParticleWorkerExecuteMessage,
  type StudioPhysicsParticleWorkerInboundMessage,
  type StudioPhysicsParticleWorkerResult,
} from "./studio-physics-particle-brush-worker-protocol";

export const STUDIO_PHYSICS_PARTICLE_WORKER_STARTUP_TIMEOUT_MS = 15_000;
export const STUDIO_PHYSICS_PARTICLE_WORKER_OPERATION_TIMEOUT_MS = 120_000;

interface StudioPhysicsParticleWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioPhysicsParticleWorkerErrorEvent {
  preventDefault?(): void;
}

export interface StudioPhysicsParticleWorkerLike {
  postMessage(
    message: StudioPhysicsParticleWorkerInboundMessage,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: StudioPhysicsParticleWorkerMessageEvent) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: StudioPhysicsParticleWorkerErrorEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: StudioPhysicsParticleWorkerMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: StudioPhysicsParticleWorkerErrorEvent) => void,
  ): void;
  terminate(): void;
}

export interface StudioPhysicsParticleWorkerClientOptions {
  readonly currentEpoch: number;
  readonly workerFactory?: () => StudioPhysicsParticleWorkerLike;
  readonly startupTimeoutMilliseconds?: number;
  readonly operationTimeoutMilliseconds?: number;
}

export interface StudioPhysicsParticleWorkerClientDiagnostics {
  readonly phase: "cold" | "starting" | "ready" | "disposed";
  readonly currentEpoch: number;
  readonly workerGeneration: number;
  readonly workerSequence: number;
  readonly activeRequestId: number | null;
  readonly operationReserved: boolean;
  readonly lastFailure:
    | StudioPhysicsParticleWorkerBoundaryFailure["reason"]
    | null;
  readonly mainThreadComputationFallback: false;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly requestEpoch: number;
  readonly workerSequence: number;
  readonly mode: "orbital" | "flow" | "spring-net";
  readonly seed: number;
  readonly inputSamples: number;
  readonly spawnCount: number;
  readonly pathPointCount: number;
  readonly connectorSegmentCount: number;
  readonly workUnits: number;
  readonly outputBytes: number;
  readonly expectedExecution: "rebuild" | "append";
  readonly appendedSpawnCount: number;
  readonly appendSourceArtifactHash: `sha256:${string}` | null;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly strokeFingerprint: `sha256:${string}`;
  readonly flowFieldHash: `sha256:${string}` | null;
  readonly replayFingerprint: `sha256:${string}`;
  readonly resolve: (result: StudioPhysicsParticleWorkerResult) => void;
  readonly signalBridge: WorkerAbortSignalBridge | null;
  readonly abort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface WorkerAbortSignalBridge {
  readonly target: AbortSignal;
  readonly initiallyAborted: boolean;
  readonly add: AbortSignal["addEventListener"];
  readonly remove: AbortSignal["removeEventListener"];
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function validTimeout(value: unknown): value is number {
  return positiveInteger(value) && value <= 600_000;
}

function defaultWorkerFactory(): StudioPhysicsParticleWorkerLike {
  return new Worker(
    new URL("./studio-physics-particle-brush-provider.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "studio-physics-particle-brush",
    },
  );
}

function invalidRequest(
  reason: "invalid-request" | "budget-exceeded",
): StudioPhysicsParticleWorkerResult {
  return Object.freeze({ status: "rejected", reason });
}

function normalizeAbortSignal(
  value: AbortSignal | undefined,
): WorkerAbortSignalBridge | null | "invalid" {
  if (value === undefined) return null;
  if (!(value instanceof AbortSignal)) return "invalid";
  try {
    const initiallyAborted = value.aborted;
    const add = value.addEventListener;
    const remove = value.removeEventListener;
    if (
      typeof initiallyAborted !== "boolean"
      || typeof add !== "function"
      || typeof remove !== "function"
    ) return "invalid";
    return Object.freeze({
      target: value,
      initiallyAborted,
      add,
      remove,
    });
  } catch {
    return "invalid";
  }
}

function abortSignalState(
  bridge: WorkerAbortSignalBridge | null,
): boolean | "invalid" {
  if (bridge === null) return false;
  try {
    const aborted = bridge.target.aborted;
    return typeof aborted === "boolean" ? aborted : "invalid";
  } catch {
    return "invalid";
  }
}

function addAbortListenerSafely(
  bridge: WorkerAbortSignalBridge | null,
  listener: () => void,
): boolean {
  if (bridge === null) return true;
  try {
    bridge.add.call(bridge.target, "abort", listener, { once: true });
    return true;
  } catch {
    try {
      bridge.remove.call(bridge.target, "abort", listener);
    } catch {
      // Internal client ownership is authoritative.
    }
    return false;
  }
}

function removeAbortListenerSafely(
  bridge: WorkerAbortSignalBridge | null,
  listener: () => void,
): void {
  if (bridge === null) return;
  try {
    bridge.remove.call(bridge.target, "abort", listener);
  } catch {
    // Internal client ownership is cleared before hostile cleanup is attempted.
  }
}

export class StudioPhysicsParticleWorkerClient {
  readonly #workerFactory: () => StudioPhysicsParticleWorkerLike;
  readonly #startupTimeoutMilliseconds: number;
  readonly #operationTimeoutMilliseconds: number;
  #currentEpoch: number;
  #phase: StudioPhysicsParticleWorkerClientDiagnostics["phase"] = "cold";
  #worker: StudioPhysicsParticleWorkerLike | null = null;
  #workerGeneration = 0;
  #workerSequence = 0;
  #nextRequestId = 1;
  #active: ActiveOperation | null = null;
  #operationReserved = false;
  #snapshotController: AbortController | null = null;
  #lifecycleRevision = 0;
  #readyPromise: Promise<boolean> | null = null;
  #resolveReady: ((ready: boolean) => void) | null = null;
  #startupTimer: ReturnType<typeof setTimeout> | null = null;
  #startupAdvanceSent = false;
  #lastFailure: StudioPhysicsParticleWorkerBoundaryFailure | null = null;
  #lastWorkerTerminationRevision: number | null = null;

  public constructor(options: StudioPhysicsParticleWorkerClientOptions) {
    const startupTimeoutMilliseconds =
      options.startupTimeoutMilliseconds
      ?? STUDIO_PHYSICS_PARTICLE_WORKER_STARTUP_TIMEOUT_MS;
    const operationTimeoutMilliseconds =
      options.operationTimeoutMilliseconds
      ?? STUDIO_PHYSICS_PARTICLE_WORKER_OPERATION_TIMEOUT_MS;
    if (
      !positiveInteger(options.currentEpoch)
      || !validTimeout(startupTimeoutMilliseconds)
      || !validTimeout(operationTimeoutMilliseconds)
      || (
        options.workerFactory !== undefined
        && typeof options.workerFactory !== "function"
      )
    ) {
      throw new TypeError(
        "Physics particle Worker client options are invalid",
      );
    }
    this.#currentEpoch = options.currentEpoch;
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.#startupTimeoutMilliseconds = startupTimeoutMilliseconds;
    this.#operationTimeoutMilliseconds = operationTimeoutMilliseconds;
  }

  readonly #onMessage = (
    event: StudioPhysicsParticleWorkerMessageEvent,
  ): void => {
    void this.#handleMessage(event);
  };

  async #handleMessage(
    event: StudioPhysicsParticleWorkerMessageEvent,
  ): Promise<void> {
    const validatingActive = this.#active;
    let message;
    try {
      message =
        await snapshotStudioPhysicsParticleWorkerOutboundMessageCooperatively(
          event.data,
          {
            isCurrent: () => (
              validatingActive === null
                ? this.#phase === "starting"
                : this.#phase === "ready"
                  && this.#active === validatingActive
            ),
          },
        );
    } catch {
      if (
        validatingActive !== null
        && this.#active !== validatingActive
      ) return;
      this.#failWorker(
        "invalid-result",
        "Physics particle Worker result validation was cancelled",
      );
      return;
    }
    if (message === null) {
      this.#failWorker(
        "protocol-error",
        "Physics particle Worker returned a malformed message",
      );
      return;
    }
    if (message.type === "studio-physics-particle/ready") {
      if (
        this.#phase !== "starting"
        || message.workerSequence !== 0
      ) {
        this.#failWorker(
          "protocol-error",
          "Physics particle Worker sent an unexpected ready message",
        );
        return;
      }
      if (message.epoch > this.#currentEpoch) {
        this.#failWorker(
          "protocol-error",
          "Physics particle Worker epoch is ahead of the client",
        );
        return;
      }
      if (message.epoch < this.#currentEpoch) {
        if (this.#startupAdvanceSent) {
          this.#failWorker(
            "protocol-error",
            "Physics particle Worker did not advance its startup epoch",
          );
          return;
        }
        this.#startupAdvanceSent = true;
        const advance: StudioPhysicsParticleWorkerAdvanceEpochMessage = {
          type: "studio-physics-particle/advance-epoch",
          version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
          epoch: this.#currentEpoch,
        };
        try {
          this.#worker?.postMessage(advance);
        } catch {
          this.#failWorker(
            "worker-unavailable",
            "Physics particle Worker rejected epoch initialization",
          );
        }
        return;
      }
      this.#markReady();
      return;
    }

    const active = this.#active;
    if (
      this.#phase !== "ready"
      || active === null
      || message.requestId !== active.requestId
      || message.requestEpoch !== active.requestEpoch
      || message.workerSequence !== active.workerSequence
    ) {
      this.#failWorker(
        "protocol-error",
        "Physics particle Worker returned an unexpected result envelope",
      );
      return;
    }
    if (!this.#matchesActive(message.result, active)) {
      this.#failWorker(
        "invalid-result",
        "Physics particle Worker output does not match its admitted request",
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
    const retire = message.result.status === "cancelled"
      || message.result.status === "rejected";
    this.#settleActive(message.result);
    if (retire) this.#retireWorker();
  }

  readonly #onWorkerError = (
    event: StudioPhysicsParticleWorkerErrorEvent,
  ): void => {
    event.preventDefault?.();
    this.#failWorker(
      "worker-unavailable",
      "Physics particle Worker crashed or failed message cloning",
    );
  };

  #matchesActive(
    result: StudioPhysicsParticleWorkerResult,
    active: ActiveOperation,
  ): boolean {
    if (result.status !== "completed") return true;
    const receipt = result.receipt;
    return receipt.epoch === active.requestEpoch
      && receipt.sequence === active.workerSequence
      && receipt.mode === active.mode
      && receipt.seed === active.seed
      && receipt.inputSamples === active.inputSamples
      && receipt.spawnCount === active.spawnCount
      && receipt.appendedSpawnCount === active.appendedSpawnCount
      && receipt.pathPointCount === active.pathPointCount
      && receipt.connectorSegmentCount === active.connectorSegmentCount
      && receipt.workUnits === active.workUnits
      && receipt.outputBytes === active.outputBytes
      && receipt.peakResidentBytes
        <= STUDIO_PHYSICS_PARTICLE_WORKER_LIMITS.maxResidentBytes
      && receipt.execution === active.expectedExecution
      && receipt.appendSourceArtifactHash === active.appendSourceArtifactHash
      && receipt.recipeFingerprint === active.recipeFingerprint
      && receipt.strokeFingerprint === active.strokeFingerprint
      && receipt.flowFieldHash === active.flowFieldHash
      && receipt.replayFingerprint === active.replayFingerprint;
  }

  #takeRequestId(): number {
    if (this.#nextRequestId >= Number.MAX_SAFE_INTEGER) {
      this.#nextRequestId = 1;
    }
    const value = this.#nextRequestId;
    this.#nextRequestId += 1;
    return value;
  }

  #cancelSnapshotReservation(): void {
    const controller = this.#snapshotController;
    this.#snapshotController = null;
    controller?.abort();
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

  #isReady(): boolean {
    return this.#phase === "ready";
  }

  #removeWorkerListeners(
    worker: StudioPhysicsParticleWorkerLike,
  ): void {
    try {
      worker.removeEventListener("message", this.#onMessage);
    } catch {
      // Internal lifecycle ownership is authoritative.
    }
    try {
      worker.removeEventListener("error", this.#onWorkerError);
    } catch {
      // Internal lifecycle ownership is authoritative.
    }
    try {
      worker.removeEventListener("messageerror", this.#onWorkerError);
    } catch {
      // Internal lifecycle ownership is authoritative.
    }
  }

  #terminateWorker(): boolean {
    const worker = this.#worker;
    if (worker === null) return false;
    this.#worker = null;
    this.#removeWorkerListeners(worker);
    worker.terminate();
    this.#lastWorkerTerminationRevision = this.#lifecycleRevision;
    return true;
  }

  #promoteLastFailureTermination(): void {
    const failure = this.#lastFailure;
    if (failure === null || failure.fallback.workerTerminated) return;
    this.#lastFailure = studioPhysicsParticleWorkerFailure(
      failure.reason,
      failure.detail,
      true,
    );
  }

  #discardProvisionalWorker(
    worker: StudioPhysicsParticleWorkerLike,
    installed: boolean,
  ): void {
    this.#removeWorkerListeners(worker);
    if (installed && this.#worker !== worker) {
      this.#promoteLastFailureTermination();
      return;
    }
    if (this.#worker === worker) this.#worker = null;
    worker.terminate();
    this.#lastWorkerTerminationRevision = this.#lifecycleRevision;
    this.#promoteLastFailureTermination();
  }

  #retireWorker(): boolean {
    const terminated = this.#terminateWorker();
    this.#clearStartupTimer();
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#startupAdvanceSent = false;
    this.#workerSequence = 0;
    if (this.#phase !== "disposed") this.#phase = "cold";
    return terminated;
  }

  #settleActive(result: StudioPhysicsParticleWorkerResult): void {
    const active = this.#active;
    if (active === null) return;
    clearTimeout(active.timer);
    this.#active = null;
    this.#operationReserved = false;
    removeAbortListenerSafely(active.signalBridge, active.abort);
    active.resolve(result);
  }

  #failWorker(
    reason: StudioPhysicsParticleWorkerBoundaryFailure["reason"],
    detail: string,
  ): StudioPhysicsParticleWorkerBoundaryFailure {
    const terminated = this.#retireWorker();
    const failure = studioPhysicsParticleWorkerFailure(
      reason,
      detail,
      terminated,
    );
    this.#lastFailure = failure;
    this.#settleActive(failure);
    return failure;
  }

  #provisionalLifecycleResult(
    admittedLifecycleRevision: number,
    admittedClientEpoch: number,
  ): StudioPhysicsParticleWorkerResult | null {
    const workerTerminated =
      this.#lastWorkerTerminationRevision === this.#lifecycleRevision;
    if (this.#phase === "disposed") {
      return studioPhysicsParticleWorkerFailure(
        "disposed",
        "Physics particle Worker client was disposed",
        workerTerminated,
      );
    }
    if (this.#lifecycleRevision === admittedLifecycleRevision) return null;
    if (this.#currentEpoch !== admittedClientEpoch) {
      return Object.freeze({ status: "rejected", reason: "stale-epoch" });
    }
    return this.#lastFailure ?? studioPhysicsParticleWorkerFailure(
      "aborted",
      "Physics particle Worker request reservation was released",
      workerTerminated,
    );
  }

  #ownsProvisionalStartup(
    admittedLifecycleRevision: number,
    readyPromise: Promise<boolean>,
  ): boolean {
    return this.#lifecycleRevision === admittedLifecycleRevision
      && this.#operationReserved
      && this.#active === null
      && this.#readyPromise === readyPromise
      && (this.#phase === "starting" || this.#phase === "ready");
  }

  #ensureReady(
    admittedLifecycleRevision: number,
  ): Promise<boolean> {
    if (
      this.#lifecycleRevision !== admittedLifecycleRevision
      || !this.#operationReserved
      || this.#active !== null
    ) return Promise.resolve(false);
    if (this.#phase === "ready") return Promise.resolve(true);
    if (this.#phase === "disposed") return Promise.resolve(false);
    if (this.#readyPromise !== null) return this.#readyPromise;

    this.#phase = "starting";
    this.#startupAdvanceSent = false;
    this.#workerSequence = 0;
    this.#readyPromise = new Promise<boolean>((resolve) => {
      this.#resolveReady = resolve;
    });
    const readyPromise = this.#readyPromise;
    let worker: StudioPhysicsParticleWorkerLike | null = null;
    let installed = false;
    try {
      worker = this.#workerFactory();
      this.#workerGeneration += 1;
      if (!this.#ownsProvisionalStartup(
        admittedLifecycleRevision,
        readyPromise,
      )) {
        this.#discardProvisionalWorker(worker, false);
        return readyPromise;
      }
      this.#worker = worker;
      installed = true;
      worker.addEventListener("message", this.#onMessage);
      worker.addEventListener("error", this.#onWorkerError);
      worker.addEventListener("messageerror", this.#onWorkerError);
      if (
        !this.#ownsProvisionalStartup(
          admittedLifecycleRevision,
          readyPromise,
        )
        || this.#worker !== worker
      ) {
        this.#discardProvisionalWorker(worker, installed);
        return readyPromise;
      }
    } catch {
      if (
        worker !== null
        && (
          !this.#ownsProvisionalStartup(
            admittedLifecycleRevision,
            readyPromise,
          )
          || this.#worker !== worker
        )
      ) {
        this.#discardProvisionalWorker(worker, installed);
        return readyPromise;
      }
      this.#failWorker(
        "worker-unavailable",
        "Physics particle Worker construction failed",
      );
      return readyPromise;
    }
    if (this.#isReady()) return readyPromise;
    const startupTimer = setTimeout(() => {
      this.#failWorker(
        "startup-timeout",
        "Physics particle Worker startup timed out",
      );
    }, this.#startupTimeoutMilliseconds);
    if (
      !this.#ownsProvisionalStartup(
        admittedLifecycleRevision,
        readyPromise,
      )
      || this.#worker !== worker
    ) {
      clearTimeout(startupTimer);
      this.#discardProvisionalWorker(worker, installed);
      return readyPromise;
    }
    if (this.#isReady()) {
      clearTimeout(startupTimer);
      return readyPromise;
    }
    this.#startupTimer = startupTimer;
    return readyPromise;
  }

  async #waitUntilReady(
    signalBridge: WorkerAbortSignalBridge | null,
    admittedLifecycleRevision: number,
  ): Promise<"aborted" | "invalid" | "ready" | "unavailable"> {
    if (signalBridge === null) {
      const ready = this.#ensureReady(admittedLifecycleRevision);
      return (await ready) ? "ready" : "unavailable";
    }
    const initialState = abortSignalState(signalBridge);
    if (initialState === "invalid") return "invalid";
    if (initialState || signalBridge.initiallyAborted) return "aborted";
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        value: "aborted" | "invalid" | "ready" | "unavailable",
      ): void => {
        if (settled) return;
        settled = true;
        removeAbortListenerSafely(signalBridge, abort);
        resolve(value);
      };
      const abort = (): void => {
        this.#failWorker(
          "aborted",
          "Physics particle Worker startup was cancelled",
        );
        finish("aborted");
      };
      if (!addAbortListenerSafely(signalBridge, abort)) {
        finish("invalid");
        return;
      }
      if (settled) return;
      const registeredState = abortSignalState(signalBridge);
      if (registeredState === "invalid") {
        finish("invalid");
        return;
      }
      if (registeredState) {
        abort();
        return;
      }
      const ready = this.#ensureReady(admittedLifecycleRevision);
      void ready.then(
        (value) => finish(value ? "ready" : "unavailable"),
        () => finish("unavailable"),
      );
    });
  }

  public async render(
    candidate: unknown,
    signal?: AbortSignal,
  ): Promise<StudioPhysicsParticleWorkerResult> {
    if (this.#phase === "disposed") {
      return studioPhysicsParticleWorkerFailure(
        "disposed",
        "Physics particle Worker client is disposed",
      );
    }
    if (this.#operationReserved || this.#active !== null) {
      return studioPhysicsParticleWorkerFailure(
        "backpressure",
        "Physics particle Worker allows one active operation",
      );
    }
    this.#operationReserved = true;
    const admittedLifecycleRevision = this.#lifecycleRevision;
    const admittedClientEpoch = this.#currentEpoch;
    let ownershipHandedOff = false;
    try {
      const signalBridge = normalizeAbortSignal(signal);
      if (signalBridge === "invalid") return invalidRequest("invalid-request");
      const initialSignalState = abortSignalState(signalBridge);
      if (initialSignalState === "invalid") {
        return invalidRequest("invalid-request");
      }
      if (signalBridge?.initiallyAborted || initialSignalState) {
        return this.#failWorker(
          "aborted",
          "Physics particle Worker request was already cancelled",
        );
      }
      const snapshotController = new AbortController();
      const abortSnapshot = (): void => snapshotController.abort();
      this.#snapshotController = snapshotController;
      let snapshotAbortRegistered = false;
      let snapshot: Awaited<ReturnType<
        typeof snapshotStudioPhysicsParticleWorkerRequestCooperatively
      >>;
      try {
        snapshotAbortRegistered = addAbortListenerSafely(
          signalBridge,
          abortSnapshot,
        );
        if (!snapshotAbortRegistered) return invalidRequest("invalid-request");
        const registeredSignalState = abortSignalState(signalBridge);
        if (
          signalBridge?.initiallyAborted
          || registeredSignalState === true
        ) snapshotController.abort();
        if (registeredSignalState === "invalid") {
          return invalidRequest("invalid-request");
        }
        snapshot =
          await snapshotStudioPhysicsParticleWorkerRequestCooperatively(
            candidate,
            {
              signal: snapshotController.signal,
              isCurrent: () => (
                this.#phase !== "disposed"
                && this.#lifecycleRevision === admittedLifecycleRevision
                && this.#operationReserved
                && this.#active === null
              ),
            },
          );
      } catch {
        const snapshotSignalState = abortSignalState(signalBridge);
        if (
          signalBridge?.initiallyAborted
          || snapshotSignalState === true
        ) {
          return studioPhysicsParticleWorkerFailure(
            "aborted",
            "Physics particle Worker request snapshot was cancelled",
            false,
          );
        }
        if (this.getDiagnostics().phase === "disposed") {
          return studioPhysicsParticleWorkerFailure(
            "disposed",
            "Physics particle Worker client was disposed",
          );
        }
        if (this.#lifecycleRevision !== admittedLifecycleRevision) {
          if (this.#currentEpoch !== admittedClientEpoch) {
            return Object.freeze({ status: "rejected", reason: "stale-epoch" });
          }
          return this.#lastFailure ?? studioPhysicsParticleWorkerFailure(
            "aborted",
            "Physics particle Worker request reservation was released",
            false,
          );
        }
        return invalidRequest("invalid-request");
      } finally {
        if (this.#snapshotController === snapshotController) {
          this.#snapshotController = null;
        }
        if (snapshotAbortRegistered) {
          removeAbortListenerSafely(signalBridge, abortSnapshot);
        }
      }
      if (!snapshot.ok) return invalidRequest(snapshot.reason);
      const postSnapshotLifecycle = this.#provisionalLifecycleResult(
        admittedLifecycleRevision,
        admittedClientEpoch,
      );
      if (postSnapshotLifecycle) return postSnapshotLifecycle;
      if (snapshot.request.requestEpoch !== this.#currentEpoch) {
        return Object.freeze({ status: "rejected", reason: "stale-epoch" });
      }
      const postSnapshotSignalState = abortSignalState(signalBridge);
      if (
        signalBridge?.initiallyAborted
        || postSnapshotSignalState === true
      ) {
        return studioPhysicsParticleWorkerFailure(
          "aborted",
          "Physics particle Worker request was cancelled before startup",
          false,
        );
      }
      if (postSnapshotSignalState === "invalid") {
        return invalidRequest("invalid-request");
      }
      const preStartupLifecycle = this.#provisionalLifecycleResult(
        admittedLifecycleRevision,
        admittedClientEpoch,
      );
      if (preStartupLifecycle) return preStartupLifecycle;

      const readiness = await this.#waitUntilReady(
        signalBridge,
        admittedLifecycleRevision,
      );
      const postStartupLifecycle = this.#provisionalLifecycleResult(
        admittedLifecycleRevision,
        admittedClientEpoch,
      );
      if (postStartupLifecycle) return postStartupLifecycle;
      if (readiness !== "ready") {
        if (readiness === "invalid") return invalidRequest("invalid-request");
        return readiness === "aborted"
          ? this.#lastFailure ?? studioPhysicsParticleWorkerFailure(
            "aborted",
            "Physics particle Worker request was cancelled",
            true,
          )
          : this.#lastFailure ?? studioPhysicsParticleWorkerFailure(
            "worker-unavailable",
            "Physics particle Worker is unavailable",
          );
      }
      const registeredSignalState = abortSignalState(signalBridge);
      const preDispatchLifecycle = this.#provisionalLifecycleResult(
        admittedLifecycleRevision,
        admittedClientEpoch,
      );
      if (preDispatchLifecycle) return preDispatchLifecycle;
      if (registeredSignalState === "invalid") {
        return invalidRequest("invalid-request");
      }
      if (registeredSignalState) {
        return this.#failWorker(
          "aborted",
          "Physics particle Worker request was cancelled before dispatch",
        );
      }

      const requestId = this.#nextRequestId >= Number.MAX_SAFE_INTEGER
        ? 1
        : this.#nextRequestId;
      const workerSequence = this.#workerSequence + 1;
      return new Promise((resolve) => {
        const abort = (): void => {
          try {
            this.#worker?.postMessage({
              type: "studio-physics-particle/cancel",
              version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
              requestId,
            });
          } finally {
            this.#failWorker(
              "aborted",
              "Physics particle Worker operation was cancelled",
            );
          }
        };
        const timer = setTimeout(() => {
          this.#failWorker(
            "operation-timeout",
            "Physics particle Worker operation timed out",
          );
        }, this.#operationTimeoutMilliseconds);
        const previousSpawnCount =
          snapshot.request.append?.previous.spawnCount ?? 0;
        const operation: ActiveOperation = Object.freeze({
          requestId,
          requestEpoch: snapshot.request.requestEpoch,
          workerSequence,
          mode: snapshot.request.recipe.mode,
          seed: snapshot.request.recipe.seed,
          inputSamples: snapshot.request.samples.length / 6,
          spawnCount: snapshot.spawnCount,
          pathPointCount: snapshot.pathPointCount,
          connectorSegmentCount: snapshot.connectorSegmentCount,
          workUnits: snapshot.workUnits,
          outputBytes: snapshot.maximumOutputBytes,
          expectedExecution: snapshot.request.append ? "append" : "rebuild",
          appendedSpawnCount: snapshot.spawnCount - previousSpawnCount,
          appendSourceArtifactHash:
            snapshot.request.append?.previous.artifactHash ?? null,
          recipeFingerprint: snapshot.recipeFingerprint,
          strokeFingerprint: snapshot.strokeFingerprint,
          flowFieldHash: snapshot.flowFieldHash,
          replayFingerprint: snapshot.replayFingerprint,
          resolve,
          signalBridge,
          abort,
          timer,
        });
        this.#active = operation;
        ownershipHandedOff = true;
        if (!addAbortListenerSafely(signalBridge, abort)) {
          this.#settleActive(invalidRequest("invalid-request"));
          return;
        }
        if (this.#active !== operation) return;
        const dispatchSignalState = abortSignalState(signalBridge);
        if (dispatchSignalState === "invalid") {
          this.#settleActive(invalidRequest("invalid-request"));
          return;
        }
        if (dispatchSignalState) {
          abort();
          return;
        }
        const committedRequestId = this.#takeRequestId();
        if (committedRequestId !== requestId) {
          this.#failWorker(
            "protocol-error",
            "Physics particle Worker request identity changed before dispatch",
          );
          return;
        }
        this.#workerSequence = workerSequence;
        const message: StudioPhysicsParticleWorkerExecuteMessage = {
          type: "studio-physics-particle/execute",
          version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
          requestId,
          workerSequence,
          request: snapshot.request,
        };
        this.#operationReserved = false;
        try {
          if (this.#worker === null) {
            throw new TypeError("Physics particle Worker is unavailable");
          }
          this.#worker.postMessage(
            message,
            studioPhysicsParticleWorkerRequestTransfers(message),
          );
        } catch {
          this.#failWorker(
            "worker-unavailable",
            "Physics particle Worker rejected request transfer",
          );
        }
      });
    } finally {
      if (!ownershipHandedOff && this.#active === null) {
        this.#operationReserved = false;
      }
    }
  }

  public release(): StudioPhysicsParticleWorkerBoundaryFailure {
    this.#lifecycleRevision += 1;
    this.#cancelSnapshotReservation();
    this.#operationReserved = false;
    const active = this.#active;
    if (active !== null) {
      try {
        this.#worker?.postMessage({
          type: "studio-physics-particle/release",
          version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
          requestId: active.requestId,
        });
      } catch {
        // Termination below is the authoritative release boundary.
      }
      return this.#failWorker(
        "aborted",
        "Physics particle Worker was released and discarded",
      );
    }
    const terminated = this.#retireWorker();
    const failure = studioPhysicsParticleWorkerFailure(
      "aborted",
      "Physics particle Worker was released and discarded",
      terminated,
    );
    this.#lastFailure = failure;
    return failure;
  }

  public advanceEpoch(nextEpoch: number): boolean {
    if (!positiveInteger(nextEpoch) || nextEpoch <= this.#currentEpoch) {
      return false;
    }
    const active = this.#active;
    this.#lifecycleRevision += 1;
    this.#cancelSnapshotReservation();
    this.#operationReserved = false;
    this.#retireWorker();
    this.#currentEpoch = nextEpoch;
    if (active !== null) {
      this.#settleActive(
        Object.freeze({ status: "rejected", reason: "stale-epoch" }),
      );
    }
    return true;
  }

  public getDiagnostics(): StudioPhysicsParticleWorkerClientDiagnostics {
    return Object.freeze({
      phase: this.#phase,
      currentEpoch: this.#currentEpoch,
      workerGeneration: this.#workerGeneration,
      workerSequence: this.#workerSequence,
      activeRequestId: this.#active?.requestId ?? null,
      operationReserved: this.#operationReserved,
      lastFailure: this.#lastFailure?.reason ?? null,
      mainThreadComputationFallback: false,
    });
  }

  public dispose(): void {
    if (this.#phase === "disposed") return;
    this.#phase = "disposed";
    this.#lifecycleRevision += 1;
    this.#cancelSnapshotReservation();
    const terminated = this.#terminateWorker();
    this.#clearStartupTimer();
    this.#resolveReady?.(false);
    this.#resolveReady = null;
    this.#readyPromise = null;
    this.#startupAdvanceSent = false;
    this.#workerSequence = 0;
    if (this.#active !== null) {
      this.#settleActive(studioPhysicsParticleWorkerFailure(
        "disposed",
        "Physics particle Worker client was disposed",
        terminated,
      ));
    }
    this.#operationReserved = false;
  }
}

export function createStudioPhysicsParticleWorkerClient(
  options: StudioPhysicsParticleWorkerClientOptions,
): StudioPhysicsParticleWorkerClient {
  return new StudioPhysicsParticleWorkerClient(options);
}
