import {
  snapshotStudioMultiLightSurfaceWorkerOutboundMessage,
  snapshotStudioMultiLightSurfaceWorkerRequest,
  STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
  studioMultiLightSurfaceRequestTransfers,
  studioMultiLightSurfaceWorkerFailure,
  studioMultiLightSurfaceWorkerRejected,
  type StudioMultiLightSurfaceWorkerAdvanceEpochMessage,
  type StudioMultiLightSurfaceWorkerBoundaryFailure,
  type StudioMultiLightSurfaceWorkerCancelMessage,
  type StudioMultiLightSurfaceWorkerExecuteMessage,
  type StudioMultiLightSurfaceWorkerInboundMessage,
  type StudioMultiLightSurfaceWorkerInputHashes,
  type StudioMultiLightSurfaceWorkerResult,
} from "./studio-multi-light-surface-worker-protocol";

export const STUDIO_MULTI_LIGHT_SURFACE_WORKER_STARTUP_TIMEOUT_MS = 15_000;
export const STUDIO_MULTI_LIGHT_SURFACE_WORKER_OPERATION_TIMEOUT_MS = 120_000;

interface StudioMultiLightSurfaceWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioMultiLightSurfaceWorkerErrorEvent {
  preventDefault?(): void;
}

export interface StudioMultiLightSurfaceWorkerLike {
  postMessage(
    message: StudioMultiLightSurfaceWorkerInboundMessage,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (
      event: StudioMultiLightSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioMultiLightSurfaceWorkerErrorEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (
      event: StudioMultiLightSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioMultiLightSurfaceWorkerErrorEvent,
    ) => void,
  ): void;
  terminate(): void;
}

export interface StudioMultiLightSurfaceWorkerClientOptions {
  readonly currentEpoch: number;
  readonly workerFactory?: () => StudioMultiLightSurfaceWorkerLike;
  readonly startupTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
}

export interface StudioMultiLightSurfaceWorkerClientDiagnostics {
  readonly phase:
    | "cold"
    | "starting"
    | "ready"
    | "unavailable"
    | "disposed";
  readonly currentEpoch: number;
  readonly activeOperation: boolean;
  readonly operationReserved: boolean;
  readonly workerGeneration: number;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly width: number;
  readonly height: number;
  readonly recipeFingerprint: `sha256:${string}`;
  readonly rigOrder: readonly string[];
  readonly evaluationOrder: readonly string[];
  readonly hashes: StudioMultiLightSurfaceWorkerInputHashes;
  readonly workUnits: number;
  readonly residentBytes: number;
  readonly resolve: (result: StudioMultiLightSurfaceWorkerResult) => void;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function defaultWorkerFactory(): StudioMultiLightSurfaceWorkerLike {
  return new Worker(
    new URL("./studio-multi-light-surface-provider.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "studio-multi-light-surface-provider",
    },
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedTimeout(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 25 || value > 300_000) {
    throw new TypeError(`${name} must be between 25 and 300000 milliseconds`);
  }
  return Math.floor(value);
}

function cancelled(): StudioMultiLightSurfaceWorkerResult {
  return Object.freeze({ status: "cancelled" });
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

export class StudioMultiLightSurfaceWorkerClient {
  private readonly workerFactory: () => StudioMultiLightSurfaceWorkerLike;
  private readonly startupTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private worker: StudioMultiLightSurfaceWorkerLike | null = null;
  private phase:
    StudioMultiLightSurfaceWorkerClientDiagnostics["phase"] = "cold";
  private currentEpoch: number;
  private nextRequestId = 1;
  private workerGeneration = 0;
  private active: ActiveOperation | null = null;
  private operationReserved = false;
  private readyPromise: Promise<boolean> | null = null;
  private resolveReady: ((ready: boolean) => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private unavailableReceipt:
    StudioMultiLightSurfaceWorkerBoundaryFailure | null = null;

  public constructor(options: StudioMultiLightSurfaceWorkerClientOptions) {
    if (
      !isPlainRecord(options)
      || !Object.keys(options).every(
        (key) => (
          key === "currentEpoch"
          || key === "workerFactory"
          || key === "startupTimeoutMs"
          || key === "operationTimeoutMs"
        ),
      )
      || !Object.hasOwn(options, "currentEpoch")
      || !Number.isSafeInteger(options.currentEpoch)
      || options.currentEpoch <= 0
      || (
        options.workerFactory !== undefined
        && typeof options.workerFactory !== "function"
      )
    ) {
      throw new TypeError(
        "Multi-light surface Worker client options are invalid",
      );
    }
    this.currentEpoch = options.currentEpoch;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.startupTimeoutMs = boundedTimeout(
      options.startupTimeoutMs,
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_STARTUP_TIMEOUT_MS,
      "startupTimeoutMs",
    );
    this.operationTimeoutMs = boundedTimeout(
      options.operationTimeoutMs,
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_OPERATION_TIMEOUT_MS,
      "operationTimeoutMs",
    );
  }

  private isDisposed(): boolean {
    return this.phase === "disposed";
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
      this.worker.removeEventListener(
        "messageerror",
        this.onWorkerError,
      );
      this.worker.terminate();
    } catch {
      // A WorkerLike cannot prevent deterministic local settlement.
    }
    this.worker = null;
  }

  private settleActive(result: StudioMultiLightSurfaceWorkerResult): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    clearTimeout(active.timer);
    if (active.signal) removeAbortListener(active.signal, active.abort);
    active.resolve(result);
  }

  private failWorker(
    reason:
      | "operation-timeout"
      | "protocol-error"
      | "startup-timeout"
      | "worker-unavailable",
    detail: string,
  ): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    const failure = studioMultiLightSurfaceWorkerFailure(reason, detail);
    this.unavailableReceipt = failure;
    this.phase = "unavailable";
    this.detachWorker();
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.settleActive(failure);
  }

  private recycleWorker(): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    this.detachWorker();
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.readyPromise = null;
    this.unavailableReceipt = null;
    this.phase = "cold";
  }

  private resultMatchesActive(
    result: StudioMultiLightSurfaceWorkerResult,
    active: ActiveOperation,
  ): boolean {
    if (result.status !== "completed") return true;
    const { receipt } = result;
    const { oracle } = receipt;
    return receipt.requestSequence === active.requestSequence
      && receipt.deviceEpoch === active.deviceEpoch
      && receipt.recipeFingerprint === active.recipeFingerprint
      && receipt.output.width === active.width
      && receipt.output.height === active.height
      && oracle.sourceSize[0] === active.width
      && oracle.sourceSize[1] === active.height
      && oracle.sourceHash === active.hashes.sourceHash
      && oracle.heightMapHash === active.hashes.heightMapHash
      && oracle.roughnessMapHash === active.hashes.roughnessMapHash
      && oracle.metalnessMapHash === active.hashes.metalnessMapHash
      && oracle.normalMapHash === active.hashes.normalMapHash
      && oracle.workUnits === active.workUnits
      && oracle.residentBytes === active.residentBytes
      && oracle.rigOrder.join("\0") === active.rigOrder.join("\0")
      && oracle.evaluationOrder.join("\0")
        === active.evaluationOrder.join("\0");
  }

  private readonly onMessage = (
    event: StudioMultiLightSurfaceWorkerMessageEvent,
  ): void => {
    if (this.phase === "disposed") return;
    const message = snapshotStudioMultiLightSurfaceWorkerOutboundMessage(
      event.data,
    );
    if (message === null) {
      this.failWorker(
        "protocol-error",
        "Multi-light surface Worker returned an invalid message",
      );
      return;
    }
    if (message.type === "studio-multi-light-surface/ready") {
      if (this.phase !== "starting" || this.worker === null) {
        this.failWorker(
          "protocol-error",
          "Multi-light surface Worker sent an unexpected ready message",
        );
        return;
      }
      if (message.currentEpoch > this.currentEpoch) {
        this.failWorker(
          "protocol-error",
          "Multi-light surface Worker epoch is ahead of the client",
        );
        return;
      }
      if (message.currentEpoch < this.currentEpoch) {
        const advance: StudioMultiLightSurfaceWorkerAdvanceEpochMessage = {
          type: "studio-multi-light-surface/advance-epoch",
          version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
          currentEpoch: this.currentEpoch,
        };
        try {
          this.worker.postMessage(advance);
        } catch {
          this.failWorker(
            "worker-unavailable",
            "Multi-light surface Worker rejected epoch initialization",
          );
          return;
        }
      }
      this.clearStartupTimer();
      this.phase = "ready";
      this.resolveReady?.(true);
      this.resolveReady = null;
      return;
    }

    const active = this.active;
    if (
      this.phase !== "ready"
      || active === null
      || message.requestId !== active.requestId
    ) {
      this.failWorker(
        "protocol-error",
        "Multi-light surface Worker returned an unexpected result",
      );
      return;
    }
    if (
      message.deviceEpoch !== active.deviceEpoch
      || message.deviceEpoch !== this.currentEpoch
      || message.requestSequence !== active.requestSequence
    ) {
      this.settleActive(
        studioMultiLightSurfaceWorkerRejected(
          "device-epoch",
          "Multi-light surface Worker result belongs to a stale epoch",
          "$.deviceEpoch",
        ),
      );
      this.recycleWorker();
      return;
    }
    if (!this.resultMatchesActive(message.result, active)) {
      this.failWorker(
        "protocol-error",
        "Multi-light surface Worker result does not match its request",
      );
      return;
    }
    this.settleActive(message.result);
  };

  private readonly onWorkerError = (
    event: StudioMultiLightSurfaceWorkerErrorEvent,
  ): void => {
    event.preventDefault?.();
    this.failWorker(
      "worker-unavailable",
      "Multi-light surface Worker crashed or could not clone a message",
    );
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
      try {
        const worker = this.workerFactory();
        if (this.phase === "disposed") {
          try {
            worker.terminate();
          } catch {
            // Disposal remains authoritative.
          }
          return;
        }
        this.worker = worker;
        this.workerGeneration += 1;
        this.worker.addEventListener("message", this.onMessage);
        this.worker.addEventListener("error", this.onWorkerError);
        this.worker.addEventListener("messageerror", this.onWorkerError);
        if (this.phase === "starting") this.startupTimer = setTimeout(() => {
          this.failWorker(
            "startup-timeout",
            "Multi-light surface Worker did not become ready in time",
          );
        }, this.startupTimeoutMs);
      } catch {
        this.failWorker(
          "worker-unavailable",
          "Multi-light surface Worker could not be constructed",
        );
      }
    });
    return this.readyPromise;
  }

  public async execute(
    request: unknown,
    signal?: AbortSignal,
  ): Promise<StudioMultiLightSurfaceWorkerResult> {
    if (this.phase === "disposed") {
      return studioMultiLightSurfaceWorkerFailure(
        "disposed",
        "Multi-light surface Worker client is disposed",
      );
    }
    if (this.active !== null || this.operationReserved) {
      return studioMultiLightSurfaceWorkerFailure(
        "backpressure",
        "Multi-light surface Worker client already has an active operation",
      );
    }
    this.operationReserved = true;
    try {
      if (
      signal !== undefined
      && (
        typeof AbortSignal === "undefined"
        || !(signal instanceof AbortSignal)
        || nativeAbortState(signal) === null
      )
    ) {
      return studioMultiLightSurfaceWorkerRejected(
        "invalid-request",
        "signal must be a native AbortSignal",
        "$.signal",
      );
    }
      const snapshot = snapshotStudioMultiLightSurfaceWorkerRequest(request);
    if (!snapshot.ok) {
      return studioMultiLightSurfaceWorkerRejected(
        snapshot.reason,
        `Multi-light surface Worker ${snapshot.reason}`,
        "$",
      );
    }
    if (
      snapshot.request.deviceEpoch !== this.currentEpoch
      || (signal !== undefined && nativeAbortState(signal) !== false)
    ) {
      return signal !== undefined && nativeAbortState(signal) !== false
        ? cancelled()
        : studioMultiLightSurfaceWorkerRejected(
            "device-epoch",
            "Multi-light surface request belongs to a stale epoch",
            "$.deviceEpoch",
          );
    }

    const readyPromise = this.ensureReady();
    const abortDuringStartup = (): void => {
      this.recycleWorker();
    };
    if (signal && !addAbortListener(signal, abortDuringStartup)) {
      this.recycleWorker();
      return cancelled();
    }
    if (signal && nativeAbortState(signal) !== false) abortDuringStartup();
    const ready = await readyPromise;
    if (signal) removeAbortListener(signal, abortDuringStartup);
    if (signal && nativeAbortState(signal) !== false) {
      this.recycleWorker();
      return cancelled();
    }
    if (snapshot.request.deviceEpoch !== this.currentEpoch) {
      return studioMultiLightSurfaceWorkerRejected(
        "device-epoch",
        "Multi-light surface request was invalidated during Worker startup",
        "$.deviceEpoch",
      );
    }
    if (!ready || this.worker === null || this.phase !== "ready") {
      if (this.isDisposed()) {
        return studioMultiLightSurfaceWorkerFailure(
          "disposed",
          "Multi-light surface Worker client is disposed",
        );
      }
      return this.unavailableReceipt
        ?? studioMultiLightSurfaceWorkerFailure(
          "worker-unavailable",
          "Multi-light surface Worker is unavailable",
        );
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    if (!Number.isSafeInteger(this.nextRequestId)) this.nextRequestId = 1;
    const worker = this.worker;
    const rigOrder = Object.freeze(
      snapshot.request.recipe.lights.map((light) => light.id),
    );
    const evaluationOrder = Object.freeze([...rigOrder].sort());
    return await new Promise<StudioMultiLightSurfaceWorkerResult>((resolve) => {
      const timer = setTimeout(() => {
        this.failWorker(
          "operation-timeout",
          "Multi-light surface Worker operation timed out",
        );
      }, this.operationTimeoutMs);
      const abort = (): void => {
        const cancel: StudioMultiLightSurfaceWorkerCancelMessage = {
          type: "studio-multi-light-surface/cancel",
          version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
          requestId,
        };
        try {
          worker.postMessage(cancel);
        } catch {
          // Hard termination below is the authoritative cancellation.
        }
        this.settleActive(cancelled());
        this.recycleWorker();
      };
      this.active = {
        requestId,
        deviceEpoch: snapshot.request.deviceEpoch,
        requestSequence: snapshot.request.requestSequence,
        width: snapshot.request.source.width,
        height: snapshot.request.source.height,
        recipeFingerprint: snapshot.request.recipe.fingerprint,
        rigOrder,
        evaluationOrder,
        hashes: snapshot.hashes,
        workUnits: snapshot.workUnits,
        residentBytes: snapshot.residentBytes,
        resolve,
        signal,
        abort,
        timer,
      };
      if (signal && !addAbortListener(signal, abort)) {
        this.settleActive(cancelled());
        this.recycleWorker();
        return;
      }
      const message: StudioMultiLightSurfaceWorkerExecuteMessage = {
        type: "studio-multi-light-surface/execute",
        version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
        requestId,
        request: snapshot.request,
      };
      try {
        worker.postMessage(
          message,
          studioMultiLightSurfaceRequestTransfers(message),
        );
      } catch {
        this.failWorker(
          "worker-unavailable",
          "Multi-light surface Worker rejected the operation",
        );
      }
    });
    } finally {
      this.operationReserved = false;
    }
  }

  public advanceCurrentEpoch(nextEpoch: number): boolean {
    if (
      this.phase === "disposed"
      || !Number.isSafeInteger(nextEpoch)
      || nextEpoch <= this.currentEpoch
    ) return false;
    this.currentEpoch = nextEpoch;
    if (this.active !== null) {
      this.settleActive(
        studioMultiLightSurfaceWorkerRejected(
          "device-epoch",
          "Multi-light surface operation was invalidated by an epoch change",
          "$.deviceEpoch",
        ),
      );
      this.recycleWorker();
      return true;
    }
    if (this.phase === "starting") {
      this.recycleWorker();
      return true;
    }
    if (this.phase === "ready" && this.worker !== null) {
      const advance: StudioMultiLightSurfaceWorkerAdvanceEpochMessage = {
        type: "studio-multi-light-surface/advance-epoch",
        version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
        currentEpoch: nextEpoch,
      };
      try {
        this.worker.postMessage(advance);
      } catch {
        this.failWorker(
          "worker-unavailable",
          "Multi-light surface Worker rejected an epoch change",
        );
      }
    }
    return true;
  }

  public getDiagnostics(): StudioMultiLightSurfaceWorkerClientDiagnostics {
    return Object.freeze({
      phase: this.phase,
      currentEpoch: this.currentEpoch,
      activeOperation: this.active !== null,
      operationReserved: this.operationReserved,
      workerGeneration: this.workerGeneration,
    });
  }

  public dispose(): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    const failure = studioMultiLightSurfaceWorkerFailure(
      "disposed",
      "Multi-light surface Worker client was disposed",
    );
    this.settleActive(failure);
    this.operationReserved = false;
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.readyPromise = null;
    this.detachWorker();
    this.phase = "disposed";
  }
}

export function createStudioMultiLightSurfaceWorkerClient(
  options: StudioMultiLightSurfaceWorkerClientOptions,
): StudioMultiLightSurfaceWorkerClient {
  return new StudioMultiLightSurfaceWorkerClient(options);
}
