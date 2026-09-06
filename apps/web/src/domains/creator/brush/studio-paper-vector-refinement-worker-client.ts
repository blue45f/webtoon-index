import {
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
  createStudioPaperVectorRefinementWorkerConfigureMessage,
  createStudioPaperVectorRefinementWorkerExecuteMessage,
  decodeStudioPaperVectorRefinementWorkerArtifact,
  snapshotStudioPaperVectorRefinementWorkerOutboundMessage,
  studioPaperVectorRefinementWorkerExecuteTransfers,
  studioPaperVectorRefinementWorkerRejection,
  studioPaperVectorRefinementWorkerResult,
  type StudioPaperVectorRefinementWorkerInboundMessage,
  type StudioPaperVectorRefinementWorkerLimits,
} from "./studio-paper-vector-refinement-worker-protocol";

import type {
  StudioPaperVectorRefinementRequest,
  StudioPaperVectorRefinementResult,
} from "./studio-paper-vector-refinement-provider";

export const STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_STARTUP_TIMEOUT_MS = 15_000;
export const STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_OPERATION_TIMEOUT_MS = 120_000;

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  readonly colno?: number;
  readonly error?: unknown;
  readonly filename?: string;
  readonly lineno?: number;
  readonly message?: string;
  preventDefault?(): void;
}

export interface StudioPaperVectorRefinementWorkerLike {
  postMessage(
    message: StudioPaperVectorRefinementWorkerInboundMessage,
    transfer?: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: WorkerMessageEventLike) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: WorkerMessageEventLike) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  terminate(): void;
}

export interface StudioPaperVectorRefinementWorkerClientOptions {
  readonly engineEpoch: number;
  readonly limits?: StudioPaperVectorRefinementWorkerLimits;
  readonly workerFactory?: () => StudioPaperVectorRefinementWorkerLike | null;
  readonly startupTimeoutMilliseconds?: number;
  readonly operationTimeoutMilliseconds?: number;
}

export interface StudioPaperVectorRefinementWorkerRefineOptions {
  readonly signal?: AbortSignal;
}

interface Startup {
  readonly promise: Promise<boolean>;
  readonly resolve: (ready: boolean) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readySeen: boolean;
}

interface ActiveOperation {
  readonly generation: number;
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly resolve: (result: StudioPaperVectorRefinementResult) => void;
}

interface WorkerBinding {
  readonly worker: StudioPaperVectorRefinementWorkerLike;
  readonly generation: number;
  readonly onMessage: (event: WorkerMessageEventLike) => void;
  readonly onError: (event: WorkerErrorEventLike) => void;
  readonly onMessageError: (event: WorkerErrorEventLike) => void;
}

let processWideLeaseOwner: symbol | null = null;
let singletonClient: StudioPaperVectorRefinementWorkerClient | null = null;

function defaultWorkerFactory(): StudioPaperVectorRefinementWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-paper-vector-refinement.worker.ts", import.meta.url),
    {
      type: "module",
      name: "studio-paper-vector-refinement",
    },
  );
}

function validTimeout(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 300_000;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactRequestKeys(value: Record<string, unknown>): boolean {
  const required = [
    "kind",
    "version",
    "requestSequence",
    "engineEpoch",
    "stage",
    "command",
  ];
  const keys = Object.keys(value);
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || key === "signal")
    && keys.length >= required.length
    && keys.length <= required.length + 1;
}

function nativeSignal(value: unknown): value is AbortSignal {
  return typeof AbortSignal !== "undefined" && value instanceof AbortSignal;
}

function safeCall(callback: () => void): void {
  try {
    callback();
  } catch {
    // Cleanup is best-effort and must never replace the terminal result.
  }
}

function detail(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 512);
}

function workerFailureDetail(event: WorkerErrorEventLike): string {
  if (event.error instanceof Error && event.error.message) {
    return event.error.message.slice(0, 512);
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return event.message.trim().slice(0, 512);
  }
  const filename =
    typeof event.filename === "string" && event.filename.trim()
      ? event.filename.trim()
      : null;
  const line = Number.isSafeInteger(event.lineno) && (event.lineno ?? 0) > 0
    ? event.lineno
    : null;
  const column = Number.isSafeInteger(event.colno) && (event.colno ?? 0) > 0
    ? event.colno
    : null;
  if (filename !== null) {
    return `Paper Worker crashed at ${filename}${line === null ? "" : `:${line}${column === null ? "" : `:${column}`}`}.`
      .slice(0, 512);
  }
  return "Paper Worker crashed.";
}

export class StudioPaperVectorRefinementWorkerClient {
  readonly #leaseOwner = Symbol("studio-paper-vector-refinement-worker");
  readonly #workerFactory: () => StudioPaperVectorRefinementWorkerLike | null;
  readonly #startupTimeoutMilliseconds: number;
  readonly #operationTimeoutMilliseconds: number;
  readonly #limits: StudioPaperVectorRefinementWorkerLimits | undefined;
  #engineEpoch: number;
  #phase: "cold" | "starting" | "ready" | "busy" | "disposed" = "cold";
  #binding: WorkerBinding | null = null;
  #startup: Startup | null = null;
  #active: ActiveOperation | null = null;
  #generation = 0;
  #nextRequestId = 1;
  #operationReserved = false;
  #startupFailureDetail: string | null = null;

  public constructor(options: StudioPaperVectorRefinementWorkerClientOptions) {
    if (
      !plainRecord(options)
      || !Number.isSafeInteger(options.engineEpoch)
      || options.engineEpoch < 0
    ) {
      throw new TypeError("Invalid Paper Worker client options.");
    }
    const startupTimeoutMilliseconds =
      options.startupTimeoutMilliseconds
      ?? STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_STARTUP_TIMEOUT_MS;
    const operationTimeoutMilliseconds =
      options.operationTimeoutMilliseconds
      ?? STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_OPERATION_TIMEOUT_MS;
    if (
      !validTimeout(startupTimeoutMilliseconds)
      || !validTimeout(operationTimeoutMilliseconds)
    ) {
      throw new TypeError("Invalid Paper Worker timeout.");
    }
    this.#engineEpoch = options.engineEpoch;
    this.#limits = options.limits;
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.#startupTimeoutMilliseconds = startupTimeoutMilliseconds;
    this.#operationTimeoutMilliseconds = operationTimeoutMilliseconds;
  }

  #releaseLease(): void {
    if (processWideLeaseOwner === this.#leaseOwner) {
      processWideLeaseOwner = null;
    }
  }

  #removeBinding(binding: WorkerBinding): void {
    binding.worker.removeEventListener("message", binding.onMessage);
    binding.worker.removeEventListener("error", binding.onError);
    binding.worker.removeEventListener(
      "messageerror",
      binding.onMessageError,
    );
    safeCall(() => binding.worker.terminate());
    if (this.#binding === binding) this.#binding = null;
  }

  #resolveStartup(ready: boolean): void {
    const startup = this.#startup;
    if (startup === null) return;
    this.#startup = null;
    clearTimeout(startup.timer);
    startup.resolve(ready);
    if (ready) this.#startupFailureDetail = null;
    if (this.#phase !== "disposed") this.#phase = ready ? "ready" : "cold";
  }

  #settleActive(
    result: StudioPaperVectorRefinementResult,
    keepWorker: boolean,
  ): void {
    const active = this.#active;
    if (active === null) return;
    this.#active = null;
    clearTimeout(active.timer);
    active.signal?.removeEventListener("abort", active.abort);
    this.#releaseLease();
    if (this.#phase !== "disposed") {
      this.#phase = keepWorker && this.#binding !== null ? "ready" : "cold";
    }
    active.resolve(result);
  }

  #recycleWorker(
    result: StudioPaperVectorRefinementResult | null = null,
  ): void {
    const binding = this.#binding;
    if (binding !== null) this.#removeBinding(binding);
    this.#resolveStartup(false);
    if (result !== null) this.#settleActive(result, false);
    if (this.#phase !== "disposed") this.#phase = "cold";
  }

  #protocolFailure(message: string): void {
    if (this.#active === null) this.#startupFailureDetail = message;
    this.#recycleWorker(
      this.#active === null
        ? null
        : studioPaperVectorRefinementWorkerRejection(
            "geometry-failed",
            message,
          ),
    );
  }

  #handleMessage(binding: WorkerBinding, candidate: unknown): void {
    if (
      this.#binding !== binding
      || binding.generation !== this.#generation
      || this.#phase === "disposed"
    ) {
      return;
    }
    const message =
      snapshotStudioPaperVectorRefinementWorkerOutboundMessage(candidate);
    if (message === null) {
      this.#protocolFailure("Paper Worker returned an invalid message.");
      return;
    }
    if (message.type === "studio-paper-vector-refinement/ready") {
      const startup = this.#startup;
      if (
        this.#phase !== "starting"
        || startup === null
        || startup.readySeen
      ) {
        this.#protocolFailure("Paper Worker sent an unexpected ready message.");
        return;
      }
      startup.readySeen = true;
      const configure =
        createStudioPaperVectorRefinementWorkerConfigureMessage(
          binding.generation,
          this.#engineEpoch,
          this.#limits,
        );
      if (configure === null) {
        this.#protocolFailure("Paper Worker configuration is invalid.");
        return;
      }
      try {
        binding.worker.postMessage(configure);
      } catch {
        this.#protocolFailure("Paper Worker rejected configuration.");
      }
      return;
    }
    if (message.type === "studio-paper-vector-refinement/configured") {
      if (
        this.#phase !== "starting"
        || this.#startup === null
        || !this.#startup.readySeen
        || message.generation !== binding.generation
        || message.engineEpoch !== this.#engineEpoch
      ) {
        this.#protocolFailure(
          "Paper Worker configuration receipt is stale.",
        );
        return;
      }
      this.#resolveStartup(true);
      return;
    }
    if (message.type === "studio-paper-vector-refinement/failure") {
      this.#protocolFailure(`Paper Worker failed: ${message.detail}`);
      return;
    }
    const active = this.#active;
    if (
      active === null
      || message.generation !== active.generation
      || message.requestId !== active.requestId
      || message.requestSequence !== active.requestSequence
      || message.engineEpoch !== active.engineEpoch
    ) {
      this.#protocolFailure("Paper Worker result identity is stale.");
      return;
    }
    if (message.type === "studio-paper-vector-refinement/rejected") {
      this.#settleActive(
        studioPaperVectorRefinementWorkerRejection(
          message.reason,
          message.detail,
        ),
        true,
      );
      return;
    }
    const artifact =
      decodeStudioPaperVectorRefinementWorkerArtifact(message.artifact);
    if (artifact === null) {
      this.#protocolFailure(
        "Paper Worker returned an invalid transferable artifact.",
      );
      return;
    }
    this.#settleActive(
      studioPaperVectorRefinementWorkerResult(artifact),
      true,
    );
  }

  #handleWorkerFailure(
    binding: WorkerBinding,
    event: WorkerErrorEventLike,
  ): void {
    if (this.#binding !== binding) return;
    // The Worker error event is cancelable. Once this client has converted it
    // into a bounded startup/runtime rejection, prevent the browser's default
    // uncaught-error reporting from leaking a handled failure to the page.
    safeCall(() => event.preventDefault?.());
    const failureDetail = workerFailureDetail(event);
    if (this.#active === null) {
      this.#startupFailureDetail = failureDetail;
    }
    this.#recycleWorker(
      this.#active === null
        ? null
        : studioPaperVectorRefinementWorkerRejection(
            "geometry-failed",
            failureDetail,
          ),
    );
  }

  #ensureReady(): Promise<boolean> {
    if (this.#phase === "ready" || this.#phase === "busy") {
      return Promise.resolve(true);
    }
    if (this.#phase === "starting" && this.#startup !== null) {
      return this.#startup.promise;
    }
    if (this.#phase === "disposed") return Promise.resolve(false);

    this.#generation =
      this.#generation >= Number.MAX_SAFE_INTEGER
        ? 1
        : this.#generation + 1;
    this.#startupFailureDetail = null;
    let worker: StudioPaperVectorRefinementWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      this.#startupFailureDetail = detail(
        error,
        "Paper Worker construction failed.",
      );
      worker = null;
    }
    if (worker === null) {
      this.#startupFailureDetail ??=
        "This browser does not expose the required Dedicated Worker API.";
      return Promise.resolve(false);
    }
    const generation = this.#generation;
    const onMessage = (event: WorkerMessageEventLike) => {
      this.#handleMessage(binding, event.data);
    };
    const onError = (event: WorkerErrorEventLike) => {
      this.#handleWorkerFailure(binding, event);
    };
    const onMessageError = (event: WorkerErrorEventLike) => {
      this.#handleWorkerFailure(binding, event);
    };
    const binding: WorkerBinding = {
      worker,
      generation,
      onMessage,
      onError,
      onMessageError,
    };
    this.#binding = binding;
    this.#phase = "starting";
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);

    let resolveStartup!: (ready: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      resolveStartup = resolve;
    });
    const timer = setTimeout(() => {
      if (this.#binding !== binding) return;
      this.#startupFailureDetail =
        "Paper Worker startup timed out before the ready receipt.";
      this.#recycleWorker();
    }, this.#startupTimeoutMilliseconds);
    this.#startup = {
      promise,
      resolve: resolveStartup,
      timer,
      readySeen: false,
    };
    return promise;
  }

  public async refine(
    candidate: unknown,
    options: StudioPaperVectorRefinementWorkerRefineOptions = {},
  ): Promise<StudioPaperVectorRefinementResult> {
    if (this.#phase === "disposed") {
      return studioPaperVectorRefinementWorkerRejection(
        "disposed",
        "Paper Worker client is disposed.",
      );
    }
    if (this.#operationReserved || this.#active !== null) {
      return studioPaperVectorRefinementWorkerRejection(
        "backpressure",
        "Paper Worker client already has an active operation.",
      );
    }
    this.#operationReserved = true;
    try {
      if (processWideLeaseOwner !== null) {
        return studioPaperVectorRefinementWorkerRejection(
          "backpressure",
          "Another Paper Worker client owns the global operation lease.",
        );
      }
      processWideLeaseOwner = this.#leaseOwner;
      if (
        !plainRecord(candidate)
        || !exactRequestKeys(candidate)
        || (
          options.signal !== undefined
          && !nativeSignal(options.signal)
        )
        || (
          candidate.signal !== undefined
          && !nativeSignal(candidate.signal)
        )
        || (
          options.signal !== undefined
          && candidate.signal !== undefined
          && options.signal !== candidate.signal
        )
      ) {
        this.#releaseLease();
        return studioPaperVectorRefinementWorkerRejection(
          "invalid-request",
          "Paper Worker request envelope or cancellation signal is invalid.",
        );
      }
      const signal =
        options.signal
        ?? candidate.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        this.#releaseLease();
        return studioPaperVectorRefinementWorkerRejection(
          "aborted",
          "Paper Worker operation was aborted before startup.",
        );
      }
      const sanitizedRequest: StudioPaperVectorRefinementRequest = {
        kind: candidate.kind as StudioPaperVectorRefinementRequest["kind"],
        version:
          candidate.version as StudioPaperVectorRefinementRequest["version"],
        requestSequence: candidate.requestSequence as number,
        engineEpoch: candidate.engineEpoch as number,
        stage: candidate.stage as "settled",
        command:
          candidate.command as StudioPaperVectorRefinementRequest["command"],
      };
      if (sanitizedRequest.engineEpoch !== this.#engineEpoch) {
        this.#releaseLease();
        return studioPaperVectorRefinementWorkerRejection(
          "epoch-mismatch",
          "Paper Worker request belongs to a stale engine epoch.",
        );
      }

      const readyPromise = this.#ensureReady();
      const generation = this.#generation;
      const requestId = this.#nextRequestId;
      this.#nextRequestId =
        requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
      const execute =
        createStudioPaperVectorRefinementWorkerExecuteMessage(
          generation,
          requestId,
          sanitizedRequest,
        );
      if (execute === null) {
        this.#releaseLease();
        return studioPaperVectorRefinementWorkerRejection(
          "invalid-request",
          "Paper Worker request failed bounded UTF-8 snapshot validation.",
        );
      }

      let abortedDuringStartup = false;
      const abortStartup = (): void => {
        abortedDuringStartup = true;
        this.#recycleWorker();
      };
      signal?.addEventListener("abort", abortStartup, { once: true });
      const ready = await readyPromise;
      signal?.removeEventListener("abort", abortStartup);
      if (abortedDuringStartup || signal?.aborted) {
        this.#releaseLease();
        return studioPaperVectorRefinementWorkerRejection(
          "aborted",
          "Paper Worker operation was aborted during startup.",
        );
      }
      if (
        !ready
        || this.#binding === null
        || this.#phase !== "ready"
        || generation !== this.#generation
      ) {
        this.#releaseLease();
        return studioPaperVectorRefinementWorkerRejection(
          "geometry-unavailable",
          this.#startupFailureDetail
            ?? "Dedicated Paper Worker is unavailable.",
        );
      }
      if (this.#engineEpoch !== sanitizedRequest.engineEpoch) {
        this.#releaseLease();
        return studioPaperVectorRefinementWorkerRejection(
          "epoch-mismatch",
          "Paper Worker epoch changed during startup.",
        );
      }

      const worker = this.#binding.worker;
      this.#phase = "busy";
      return await new Promise<StudioPaperVectorRefinementResult>((resolve) => {
        const abort = (): void => {
          this.#settleActive(
            studioPaperVectorRefinementWorkerRejection(
              "aborted",
              "Paper Worker operation was aborted.",
            ),
            false,
          );
          this.#recycleWorker();
        };
        const timer = setTimeout(() => {
          this.#settleActive(
            studioPaperVectorRefinementWorkerRejection(
              "geometry-failed",
              "Paper Worker operation timed out.",
            ),
            false,
          );
          this.#recycleWorker();
        }, this.#operationTimeoutMilliseconds);
        this.#active = {
          generation,
          requestId,
          requestSequence: sanitizedRequest.requestSequence,
          engineEpoch: sanitizedRequest.engineEpoch,
          signal,
          abort,
          timer,
          resolve,
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        try {
          worker.postMessage(
            execute,
            studioPaperVectorRefinementWorkerExecuteTransfers(execute),
          );
        } catch {
          this.#settleActive(
            studioPaperVectorRefinementWorkerRejection(
              "geometry-failed",
              "Paper Worker rejected the transferable request.",
            ),
            false,
          );
          this.#recycleWorker();
        }
      });
    } finally {
      this.#operationReserved = false;
      if (this.#active === null) this.#releaseLease();
    }
  }

  public advanceEngineEpoch(): number {
    if (this.#phase === "disposed") return this.#engineEpoch;
    this.#engineEpoch =
      this.#engineEpoch >= Number.MAX_SAFE_INTEGER
        ? 0
        : this.#engineEpoch + 1;
    this.#settleActive(
      studioPaperVectorRefinementWorkerRejection(
        "epoch-mismatch",
        "Paper Worker engine epoch advanced during execution.",
      ),
      false,
    );
    this.#recycleWorker();
    return this.#engineEpoch;
  }

  public snapshot(): Readonly<{
    readonly phase: "cold" | "starting" | "ready" | "busy" | "disposed";
    readonly engineEpoch: number;
    readonly generation: number;
    readonly active: boolean;
    readonly globalLeaseOwned: boolean;
    readonly mainThreadFallback: false;
  }> {
    return Object.freeze({
      phase: this.#phase,
      engineEpoch: this.#engineEpoch,
      generation: this.#generation,
      active: this.#active !== null || this.#operationReserved,
      globalLeaseOwned: processWideLeaseOwner === this.#leaseOwner,
      mainThreadFallback: false,
    });
  }

  public dispose(): void {
    if (this.#phase === "disposed") return;
    this.#phase = "disposed";
    this.#settleActive(
      studioPaperVectorRefinementWorkerRejection(
        "disposed",
        "Paper Worker client was disposed during execution.",
      ),
      false,
    );
    this.#recycleWorker();
    this.#releaseLease();
    if (singletonClient === this) singletonClient = null;
  }
}

export function createStudioPaperVectorRefinementWorkerClient(
  options: StudioPaperVectorRefinementWorkerClientOptions,
): StudioPaperVectorRefinementWorkerClient {
  return new StudioPaperVectorRefinementWorkerClient(options);
}

export function getStudioPaperVectorRefinementWorkerClient(
  options: StudioPaperVectorRefinementWorkerClientOptions = {
    engineEpoch: 1,
  },
): StudioPaperVectorRefinementWorkerClient {
  if (
    singletonClient === null
    || singletonClient.snapshot().phase === "disposed"
  ) {
    singletonClient =
      createStudioPaperVectorRefinementWorkerClient(options);
  } else if (
    singletonClient.snapshot().engineEpoch !== options.engineEpoch
  ) {
    throw new Error(
      "The global Paper Worker client already exists with another epoch.",
    );
  }
  return singletonClient;
}

export function disposeStudioPaperVectorRefinementWorkerClient(): void {
  singletonClient?.dispose();
  singletonClient = null;
}

export function studioPaperVectorRefinementWorkerProtocolVersion(): number {
  return STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION;
}
