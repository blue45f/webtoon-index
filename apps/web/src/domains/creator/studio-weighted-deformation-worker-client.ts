import {
  STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
  snapshotStudioWeightedDeformationWorkerOutboundMessage,
  snapshotStudioWeightedDeformationWorkerRequest,
  studioWeightedDeformationRequestTransfers,
  studioWeightedDeformationWorkerFailure,
  type StudioWeightedDeformationWorkerAdvanceEpochMessage,
  type StudioWeightedDeformationWorkerBoundaryFailure,
  type StudioWeightedDeformationWorkerCancelMessage,
  type StudioWeightedDeformationWorkerExecuteMessage,
  type StudioWeightedDeformationWorkerInboundMessage,
  type StudioWeightedDeformationWorkerResult,
} from "./studio-weighted-deformation-worker-protocol";

export const STUDIO_WEIGHTED_DEFORMATION_WORKER_STARTUP_TIMEOUT_MS = 15_000;
export const STUDIO_WEIGHTED_DEFORMATION_WORKER_OPERATION_TIMEOUT_MS = 120_000;

interface StudioWeightedDeformationWorkerMessageEvent {
  readonly data: unknown;
}

interface StudioWeightedDeformationWorkerErrorEvent {
  preventDefault?(): void;
}

export interface StudioWeightedDeformationWorkerLike {
  postMessage(
    message: StudioWeightedDeformationWorkerInboundMessage,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (
      event: StudioWeightedDeformationWorkerMessageEvent,
    ) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioWeightedDeformationWorkerErrorEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (
      event: StudioWeightedDeformationWorkerMessageEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (
      event: StudioWeightedDeformationWorkerErrorEvent,
    ) => void,
  ): void;
  terminate(): void;
}

export interface StudioWeightedDeformationWorkerClientOptions {
  readonly currentEpoch: number;
  readonly workerFactory?: () => StudioWeightedDeformationWorkerLike;
  readonly startupTimeoutMs?: number;
  readonly operationTimeoutMs?: number;
}

export interface StudioWeightedDeformationWorkerClientDiagnostics {
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
  readonly requestEpoch: number;
  readonly dimension: 2 | 3;
  readonly vertexCount: number;
  readonly sourceCount: number;
  readonly sourcePointCount: number;
  readonly workUnits: number;
  readonly hasTextureCoordinates: boolean;
  readonly requestSha256: `sha256:${string}`;
  readonly textureCoordinatesSha256: `sha256:${string}` | null;
  readonly resolve: (
    result: StudioWeightedDeformationWorkerResult,
  ) => void;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

function defaultWorkerFactory(): StudioWeightedDeformationWorkerLike {
  return new Worker(
    new URL("./studio-weighted-deformation-provider.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "studio-weighted-deformation-provider",
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

function providerRejection(
  reason: "invalid-request" | "budget-exceeded" | "stale-epoch",
): StudioWeightedDeformationWorkerResult {
  return Object.freeze({ status: "rejected", reason });
}

function cancelled(): StudioWeightedDeformationWorkerResult {
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

export class StudioWeightedDeformationWorkerClient {
  private readonly workerFactory: () => StudioWeightedDeformationWorkerLike;
  private readonly startupTimeoutMs: number;
  private readonly operationTimeoutMs: number;
  private worker: StudioWeightedDeformationWorkerLike | null = null;
  private phase:
    StudioWeightedDeformationWorkerClientDiagnostics["phase"] = "cold";
  private currentEpoch: number;
  private nextRequestId = 1;
  private workerGeneration = 0;
  private active: ActiveOperation | null = null;
  private operationReserved = false;
  private readyPromise: Promise<boolean> | null = null;
  private resolveReady: ((ready: boolean) => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private unavailableReceipt:
    StudioWeightedDeformationWorkerBoundaryFailure | null = null;

  constructor(options: StudioWeightedDeformationWorkerClientOptions) {
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
        "Weighted deformation Worker client options are invalid",
      );
    }
    this.currentEpoch = options.currentEpoch;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.startupTimeoutMs = boundedTimeout(
      options.startupTimeoutMs,
      STUDIO_WEIGHTED_DEFORMATION_WORKER_STARTUP_TIMEOUT_MS,
      "startupTimeoutMs",
    );
    this.operationTimeoutMs = boundedTimeout(
      options.operationTimeoutMs,
      STUDIO_WEIGHTED_DEFORMATION_WORKER_OPERATION_TIMEOUT_MS,
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

  private settleActive(
    result: StudioWeightedDeformationWorkerResult,
  ): void {
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
    const failure = studioWeightedDeformationWorkerFailure(reason, detail);
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

  private readonly onMessage = (
    event: StudioWeightedDeformationWorkerMessageEvent,
  ): void => {
    if (this.phase === "disposed") return;
    const message = snapshotStudioWeightedDeformationWorkerOutboundMessage(
      event.data,
    );
    if (message === null) {
      this.failWorker(
        "protocol-error",
        "Weighted deformation Worker returned an invalid message",
      );
      return;
    }
    if (message.type === "studio-weighted-deformation/ready") {
      if (this.phase !== "starting" || this.worker === null) {
        this.failWorker(
          "protocol-error",
          "Weighted deformation Worker sent an unexpected ready message",
        );
        return;
      }
      if (message.currentEpoch > this.currentEpoch) {
        this.failWorker(
          "protocol-error",
          "Weighted deformation Worker epoch is ahead of the client",
        );
        return;
      }
      if (message.currentEpoch < this.currentEpoch) {
        const advance: StudioWeightedDeformationWorkerAdvanceEpochMessage = {
          type: "studio-weighted-deformation/advance-epoch",
          version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
          currentEpoch: this.currentEpoch,
        };
        try {
          this.worker.postMessage(advance);
        } catch {
          this.failWorker(
            "worker-unavailable",
            "Weighted deformation Worker rejected epoch initialization",
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
        "Weighted deformation Worker returned an unexpected result",
      );
      return;
    }
    if (
      message.requestEpoch !== active.requestEpoch
      || message.requestEpoch !== this.currentEpoch
    ) {
      this.settleActive(providerRejection("stale-epoch"));
      this.recycleWorker();
      return;
    }
    if (!this.resultMatchesActiveRequest(message.result, active)) {
      this.failWorker(
        "protocol-error",
        "Weighted deformation Worker result does not match its request",
      );
      return;
    }
    this.settleActive(message.result);
  };

  private readonly onWorkerError = (
    event: StudioWeightedDeformationWorkerErrorEvent,
  ): void => {
    event.preventDefault?.();
    this.failWorker(
      "worker-unavailable",
      "Weighted deformation Worker crashed or could not clone a message",
    );
  };

  private resultMatchesActiveRequest(
    result: StudioWeightedDeformationWorkerResult,
    active: ActiveOperation,
  ): boolean {
    if (result.status !== "completed") return true;
    const { artifact } = result;
    const { receipt } = artifact;
    return (
      artifact.dimension === active.dimension
      && artifact.positions.length
        === active.vertexCount * active.dimension
      && (artifact.textureCoordinates !== undefined)
        === active.hasTextureCoordinates
      && receipt.vertexCount === active.vertexCount
      && receipt.sourceCount === active.sourceCount
      && receipt.sourcePointCount === active.sourcePointCount
      && receipt.workUnits === active.workUnits
      && receipt.requestSha256 === active.requestSha256
      && receipt.textureCoordinatesSha256
        === active.textureCoordinatesSha256
    );
  }

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
      const worker = this.workerFactory();
      if (this.isDisposed()) {
        try {
          worker.terminate();
        } catch {
          // Disposal remains authoritative.
        }
        return this.readyPromise;
      }
      this.worker = worker;
      this.workerGeneration += 1;
      this.worker.addEventListener("message", this.onMessage);
      this.worker.addEventListener("error", this.onWorkerError);
      this.worker.addEventListener(
        "messageerror",
        this.onWorkerError,
      );
    } catch {
      this.failWorker(
        "worker-unavailable",
        "Weighted deformation Worker construction failed",
      );
      return this.readyPromise;
    }
    if (this.phase === "starting") this.startupTimer = setTimeout(
      () => {
        this.failWorker(
          "startup-timeout",
          "Weighted deformation Worker startup timed out",
        );
      },
      this.startupTimeoutMs,
    );
    return this.readyPromise;
  }

  private async waitUntilReady(
    signal: AbortSignal | undefined,
  ): Promise<"cancelled" | "ready" | "unavailable"> {
    const ready = this.ensureReady();
    if (signal === undefined) {
      return (await ready) ? "ready" : "unavailable";
    }
    if (nativeAbortState(signal) !== false) return "cancelled";
    return new Promise((resolve) => {
      let settled = false;
      const finish = (
        value: "cancelled" | "ready" | "unavailable",
      ): void => {
        if (settled) return;
        settled = true;
        removeAbortListener(signal, abort);
        resolve(value);
      };
      const abort = (): void => {
        this.recycleWorker();
        finish("cancelled");
      };
      if (!addAbortListener(signal, abort)) {
        this.recycleWorker();
        finish("cancelled");
        return;
      }
      void ready.then(
        (value) => finish(value ? "ready" : "unavailable"),
        () => finish("unavailable"),
      );
    });
  }

  public async execute(
    candidate: unknown,
    signal?: AbortSignal,
  ): Promise<StudioWeightedDeformationWorkerResult> {
    if (this.phase === "disposed") {
      return studioWeightedDeformationWorkerFailure(
        "disposed",
        "Weighted deformation Worker client is disposed",
      );
    }
    if (this.operationReserved || this.active !== null) {
      return studioWeightedDeformationWorkerFailure(
        "backpressure",
        "Weighted deformation Worker permits one active operation",
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
        return providerRejection("invalid-request");
      }
      if (signal && nativeAbortState(signal)) return cancelled();
    const snapshot = snapshotStudioWeightedDeformationWorkerRequest(
      candidate,
    );
    if (!snapshot.ok) return providerRejection(snapshot.reason);
    if (
      snapshot.request.requestEpoch !== this.currentEpoch
      || snapshot.request.currentEpoch !== this.currentEpoch
    ) {
      return providerRejection("stale-epoch");
    }

      const readiness = await this.waitUntilReady(signal);
      if (readiness === "cancelled") return cancelled();
      if (this.isDisposed()) {
        return studioWeightedDeformationWorkerFailure(
          "disposed",
          "Weighted deformation Worker client was disposed during startup",
        );
      }
      if (readiness === "unavailable" || this.worker === null) {
        return (
          this.unavailableReceipt
          ?? studioWeightedDeformationWorkerFailure(
            "worker-unavailable",
            "Weighted deformation Worker is unavailable",
          )
        );
      }
      if (signal && nativeAbortState(signal) !== false) {
        this.recycleWorker();
        return cancelled();
      }
      if (
        snapshot.request.requestEpoch !== this.currentEpoch
        || snapshot.request.currentEpoch !== this.currentEpoch
      ) {
        return providerRejection("stale-epoch");
      }

      const requestId = this.nextRequestId;
      this.nextRequestId = requestId >= Number.MAX_SAFE_INTEGER
        ? 1
        : requestId + 1;
      const message: StudioWeightedDeformationWorkerExecuteMessage = {
        type: "studio-weighted-deformation/execute",
        version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
        requestId,
        request: snapshot.request,
      };
      return await new Promise<StudioWeightedDeformationWorkerResult>(
        (resolve) => {
          const abort = (): void => {
            if (this.active?.requestId !== requestId) return;
            const cancelMessage:
              StudioWeightedDeformationWorkerCancelMessage = {
                type: "studio-weighted-deformation/cancel",
                version:
                  STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
                requestId,
              };
            try {
              this.worker?.postMessage(cancelMessage);
            } catch {
              // Hard Worker termination below still enforces cancellation.
            }
            this.settleActive(cancelled());
            // The oracle is synchronous once entered. Termination is the only
            // immediate cancellation boundary while it occupies the Worker.
            this.recycleWorker();
          };
          const timer = setTimeout(
            () => {
              this.failWorker(
                "operation-timeout",
                "Weighted deformation Worker operation timed out",
              );
            },
            this.operationTimeoutMs,
          );
          this.active = {
            requestId,
            requestEpoch: snapshot.request.requestEpoch,
            dimension: snapshot.request.mesh.dimension,
            vertexCount:
              snapshot.request.mesh.positions.length
              / snapshot.request.mesh.dimension,
            sourceCount: snapshot.request.sources.length,
            sourcePointCount: snapshot.request.sources.reduce(
              (sum, source) => (
                sum + source.restPoints.length / source.dimension
              ),
              0,
            ),
            workUnits: snapshot.workUnits,
            hasTextureCoordinates:
              snapshot.request.mesh.textureCoordinates !== undefined,
            requestSha256: snapshot.requestSha256,
            textureCoordinatesSha256:
              snapshot.textureCoordinatesSha256,
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
          try {
            this.worker?.postMessage(
              message,
              studioWeightedDeformationRequestTransfers(message),
            );
          } catch {
            this.failWorker(
              "worker-unavailable",
              "Weighted deformation Worker rejected the request",
            );
          }
        },
      );
    } finally {
      this.operationReserved = false;
    }
  }

  public advanceCurrentEpoch(nextEpoch: number): boolean {
    if (
      this.phase === "disposed"
      || !Number.isSafeInteger(nextEpoch)
      || nextEpoch <= this.currentEpoch
    ) {
      return false;
    }
    this.currentEpoch = nextEpoch;
    const active = this.active;
    if (active !== null && active.requestEpoch < nextEpoch) {
      try {
        this.worker?.postMessage({
          type: "studio-weighted-deformation/cancel",
          version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
          requestId: active.requestId,
        });
      } catch {
        // Termination below is the authoritative stale-work boundary.
      }
      this.settleActive(providerRejection("stale-epoch"));
      this.recycleWorker();
      return true;
    }
    if (this.worker !== null && this.phase === "ready") {
      try {
        this.worker.postMessage({
          type: "studio-weighted-deformation/advance-epoch",
          version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
          currentEpoch: nextEpoch,
        });
      } catch {
        this.failWorker(
          "worker-unavailable",
          "Weighted deformation Worker rejected the epoch update",
        );
      }
    }
    return true;
  }

  public getDiagnostics():
    StudioWeightedDeformationWorkerClientDiagnostics {
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
    this.phase = "disposed";
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.detachWorker();
    this.settleActive(
      studioWeightedDeformationWorkerFailure(
        "disposed",
        "Weighted deformation Worker client is disposed",
      ),
    );
  }
}

export function createStudioWeightedDeformationWorkerClient(
  options: StudioWeightedDeformationWorkerClientOptions,
): StudioWeightedDeformationWorkerClient {
  return new StudioWeightedDeformationWorkerClient(options);
}
