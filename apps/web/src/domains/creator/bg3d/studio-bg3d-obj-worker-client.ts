import {
  STUDIO_BG3D_OBJ_WORKER_BUDGETS,
  STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
  isStudioBg3dObjWorkerRequest,
  isStudioBg3dObjWorkerResponse,
  studioBg3dObjWorkerRequestTransfers,
  type StudioBg3dObjWorkerCanonicalResult,
  type StudioBg3dObjWorkerFailureCode,
  type StudioBg3dObjWorkerMtlEntry,
  type StudioBg3dObjWorkerProgressStage,
  type StudioBg3dObjWorkerRequest,
  type StudioBg3dObjWorkerResponse,
} from "./studio-bg3d-obj-worker-protocol";

export const STUDIO_BG3D_OBJ_WORKER_MAX_QUEUED_JOBS = 2;
export const STUDIO_BG3D_OBJ_WORKER_MAX_OWNED_INPUT_BYTES = 96 * 1024 * 1024;
export const STUDIO_BG3D_OBJ_WORKER_DEFAULT_EXECUTION_TIMEOUT_MS = 90_000;
export const STUDIO_BG3D_OBJ_WORKER_DEFAULT_QUEUE_TIMEOUT_MS = 30_000;

export type StudioBg3dObjWorkerClientErrorCode =
  | StudioBg3dObjWorkerFailureCode
  | "aborted"
  | "capacity-exceeded"
  | "disposed"
  | "post-failed"
  | "protocol"
  | "queue-timeout"
  | "timeout"
  | "worker-failed"
  | "worker-unavailable";

export type StudioBg3dObjWorkerClientProgressStage =
  | "queued"
  | StudioBg3dObjWorkerProgressStage
  | "validating"
  | "ready";

export interface StudioBg3dObjWorkerClientProgress {
  readonly generationId: number;
  readonly requestId: number;
  readonly stage: StudioBg3dObjWorkerClientProgressStage;
  readonly progress: number;
}

export interface StudioBg3dObjWorkerClientInput {
  readonly primaryPath: string;
  readonly bytes: ArrayBuffer;
  /** Canonical-path sorted, unique MTL entries. Ownership transfers after admission. */
  readonly materialLibraries: readonly StudioBg3dObjWorkerMtlEntry[];
  /** Canonical-path sorted, unique resource catalog. */
  readonly resourcePaths: readonly string[];
}

export interface StudioBg3dObjWorkerClientParseOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dObjWorkerClientProgress) => void;
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioBg3dObjWorkerLike {
  postMessage(message: StudioBg3dObjWorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  terminate(): void;
}

export interface StudioBg3dObjWorkerClientOptions {
  readonly workerFactory?: () => StudioBg3dObjWorkerLike | null;
  readonly executionTimeoutMs?: number;
  readonly queueTimeoutMs?: number;
}

interface RequestAuthority {
  readonly generationId: number;
  readonly requestId: number;
  readonly primaryPath: string;
  readonly materialPaths: ReadonlySet<string>;
  readonly resourcePaths: ReadonlySet<string>;
}

interface PendingJob {
  readonly authority: RequestAuthority;
  readonly request: StudioBg3dObjWorkerRequest;
  readonly ownedInputBytes: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: StudioBg3dObjWorkerClientParseOptions["onProgress"];
  readonly resolve: (result: StudioBg3dObjWorkerCanonicalResult) => void;
  readonly reject: (error: StudioBg3dObjWorkerClientError) => void;
  abortListener?: () => void;
  accountingReleased: boolean;
  executionTimeout: ReturnType<typeof setTimeout> | null;
  handleMessage?: (event: WorkerMessageEventLike) => void;
  handleWorkerFailure?: (event: WorkerErrorEventLike) => void;
  lastProgress: number;
  queueTimeout: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  stageOrder: number;
  worker: StudioBg3dObjWorkerLike | null;
}

const STAGE_ORDER: Readonly<Record<StudioBg3dObjWorkerClientProgressStage, number>> = {
  queued: 0,
  parsing: 1,
  canonicalizing: 2,
  validating: 3,
  ready: 4,
};

export class StudioBg3dObjWorkerClientError extends Error {
  constructor(readonly code: StudioBg3dObjWorkerClientErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = code === "aborted" ? "AbortError" : "StudioBg3dObjWorkerClientError";
  }
}

function createStudioBg3dObjModuleWorker(): StudioBg3dObjWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-bg3d-obj.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-bg3d-obj",
  });
}

function boundedTimeout(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(1, Math.trunc(value)));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function responseIdentity(value: unknown): {
  readonly generationId: number;
  readonly requestId: number;
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const generationId = Reflect.get(value, "generationId");
  const requestId = Reflect.get(value, "requestId");
  return positiveSafeInteger(generationId) && positiveSafeInteger(requestId)
    ? { generationId, requestId }
    : null;
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Cleanup and observational callbacks may not change job ownership.
  }
}

function snapshotInput(
  input: StudioBg3dObjWorkerClientInput,
  requestId: number,
  generationId: number,
): StudioBg3dObjWorkerRequest {
  const materialLibraries = input.materialLibraries.map((entry) => ({
    path: entry.path,
    sourceByteLength: entry.sourceByteLength,
    bytes: entry.bytes,
  }));
  const request: StudioBg3dObjWorkerRequest = {
    version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
    kind: "parse",
    requestId,
    generationId,
    primaryPath: input.primaryPath,
    sourceByteLength: input.bytes.byteLength,
    bytes: input.bytes,
    materialLibraries,
    resourcePaths: [...input.resourcePaths],
    budgets: STUDIO_BG3D_OBJ_WORKER_BUDGETS,
  };
  if (!isStudioBg3dObjWorkerRequest(request)) {
    throw new StudioBg3dObjWorkerClientError("protocol");
  }
  return request;
}

function ownedInputByteLength(request: StudioBg3dObjWorkerRequest): number {
  let total = request.sourceByteLength;
  for (const entry of request.materialLibraries) {
    if (total > Number.MAX_SAFE_INTEGER - entry.sourceByteLength) {
      throw new StudioBg3dObjWorkerClientError("protocol");
    }
    total += entry.sourceByteLength;
  }
  return total;
}

/**
 * The protocol helper validates against a still-attached request. Once ownership is transferred,
 * its buffers are detached in the main realm, so retain only immutable request authority and apply
 * the same identity/catalog checks without allocating duplicate input buffers.
 */
function isExactResponseForAuthority(
  value: unknown,
  authority: RequestAuthority,
): value is StudioBg3dObjWorkerResponse {
  if (!isStudioBg3dObjWorkerResponse(value)) return false;
  if (
    value.requestId !== authority.requestId
    || value.generationId !== authority.generationId
  ) return false;
  if (value.kind !== "result") return true;
  if (value.result.primaryPath !== authority.primaryPath) return false;
  if (value.result.usedResourcePaths.some((path) => !authority.resourcePaths.has(path))) return false;
  return value.result.materials.every((material) =>
    material.sourceMtlPath === null || authority.materialPaths.has(material.sourceMtlPath));
}

/** Capacity-one OBJ parser with bounded queued byte ownership and a fresh Worker for every job. */
export class StudioBg3dObjWorkerClient {
  readonly #workerFactory: () => StudioBg3dObjWorkerLike | null;
  readonly #executionTimeoutMs: number;
  readonly #queueTimeoutMs: number;
  readonly #queue: PendingJob[] = [];
  #active: PendingJob | null = null;
  #disposed = false;
  #nextGenerationId = 1;
  #nextRequestId = 1;
  #ownedInputBytes = 0;

  constructor(options: StudioBg3dObjWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory ?? createStudioBg3dObjModuleWorker;
    this.#executionTimeoutMs = boundedTimeout(
      options.executionTimeoutMs,
      STUDIO_BG3D_OBJ_WORKER_DEFAULT_EXECUTION_TIMEOUT_MS,
      STUDIO_BG3D_OBJ_WORKER_DEFAULT_EXECUTION_TIMEOUT_MS,
    );
    this.#queueTimeoutMs = boundedTimeout(
      options.queueTimeoutMs,
      STUDIO_BG3D_OBJ_WORKER_DEFAULT_QUEUE_TIMEOUT_MS,
      STUDIO_BG3D_OBJ_WORKER_DEFAULT_QUEUE_TIMEOUT_MS,
    );
  }

  get activeCount(): 0 | 1 {
    return this.#active ? 1 : 0;
  }

  get queuedCount(): number {
    return this.#queue.length;
  }

  get ownedInputBytes(): number {
    return this.#ownedInputBytes;
  }

  parse(
    input: StudioBg3dObjWorkerClientInput,
    options: StudioBg3dObjWorkerClientParseOptions = {},
  ): Promise<StudioBg3dObjWorkerCanonicalResult> {
    if (this.#disposed) {
      return Promise.reject(new StudioBg3dObjWorkerClientError("disposed"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new StudioBg3dObjWorkerClientError("aborted"));
    }

    const requestId = this.#allocateRequestId();
    const generationId = this.#allocateGenerationId();
    let request: StudioBg3dObjWorkerRequest;
    let inputBytes: number;
    try {
      request = snapshotInput(input, requestId, generationId);
      inputBytes = ownedInputByteLength(request);
    } catch (error) {
      return Promise.reject(error);
    }
    const totalJobs = this.#queue.length + (this.#active ? 1 : 0);
    if (
      totalJobs >= STUDIO_BG3D_OBJ_WORKER_MAX_QUEUED_JOBS + 1
      || inputBytes > STUDIO_BG3D_OBJ_WORKER_MAX_OWNED_INPUT_BYTES - this.#ownedInputBytes
    ) {
      return Promise.reject(new StudioBg3dObjWorkerClientError("capacity-exceeded"));
    }

    const authority: RequestAuthority = {
      generationId,
      requestId,
      primaryPath: request.primaryPath,
      materialPaths: new Set(request.materialLibraries.map((entry) => entry.path)),
      resourcePaths: new Set(request.resourcePaths),
    };
    this.#ownedInputBytes += inputBytes;
    return new Promise((resolve, reject) => {
      const job: PendingJob = {
        authority,
        request,
        ownedInputBytes: inputBytes,
        signal: options.signal,
        onProgress: options.onProgress,
        resolve,
        reject,
        accountingReleased: false,
        executionTimeout: null,
        lastProgress: 0,
        queueTimeout: null,
        settled: false,
        stageOrder: 0,
        worker: null,
      };
      job.abortListener = () => this.#abort(job);
      options.signal?.addEventListener("abort", job.abortListener, { once: true });
      if (options.signal?.aborted) {
        this.#settle(job, new StudioBg3dObjWorkerClientError("aborted"));
        return;
      }
      this.#queue.push(job);
      job.queueTimeout = setTimeout(() => {
        if (!job.settled && this.#active !== job) {
          this.#settle(job, new StudioBg3dObjWorkerClientError("queue-timeout"));
        }
      }, this.#queueTimeoutMs);
      this.#emitProgress(job, "queued", 0);
      this.#drain();
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    if (active) this.#settle(active, new StudioBg3dObjWorkerClientError("disposed"), false);
    while (this.#queue.length > 0) {
      const queued = this.#queue.shift();
      if (queued) this.#settle(queued, new StudioBg3dObjWorkerClientError("disposed"), false);
    }
    this.#active = null;
  }

  #allocateGenerationId(): number {
    const result = this.#nextGenerationId;
    this.#nextGenerationId = result >= Number.MAX_SAFE_INTEGER ? 1 : result + 1;
    return result;
  }

  #allocateRequestId(): number {
    const result = this.#nextRequestId;
    this.#nextRequestId = result >= Number.MAX_SAFE_INTEGER ? 1 : result + 1;
    return result;
  }

  #drain(): void {
    if (this.#disposed || this.#active) return;
    const job = this.#queue.shift();
    if (!job) return;
    if (job.settled) {
      queueMicrotask(() => this.#drain());
      return;
    }
    if (job.queueTimeout !== null) {
      clearTimeout(job.queueTimeout);
      job.queueTimeout = null;
    }
    if (job.signal?.aborted) {
      this.#settle(job, new StudioBg3dObjWorkerClientError("aborted"));
      return;
    }
    this.#active = job;

    // A queued caller could have detached an input despite transferring ownership to this client.
    if (!isStudioBg3dObjWorkerRequest(job.request)) {
      this.#settle(job, new StudioBg3dObjWorkerClientError("protocol"));
      return;
    }

    let worker: StudioBg3dObjWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      this.#settle(job, new StudioBg3dObjWorkerClientError("worker-unavailable", { cause: error }));
      return;
    }
    if (!worker) {
      this.#settle(job, new StudioBg3dObjWorkerClientError("worker-unavailable"));
      return;
    }
    job.worker = worker;

    const handleWorkerFailure = (event: WorkerErrorEventLike): void => {
      event.preventDefault?.();
      if (this.#active === job) {
        this.#settle(job, new StudioBg3dObjWorkerClientError("worker-failed"));
      }
    };
    const handleMessage = (event: WorkerMessageEventLike): void => {
      if (this.#active !== job || job.settled) return;
      const identity = responseIdentity(event.data);
      if (
        identity
        && (
          identity.generationId !== job.authority.generationId
          || identity.requestId !== job.authority.requestId
        )
      ) {
        return;
      }
      if (!identity) {
        this.#settle(job, new StudioBg3dObjWorkerClientError("protocol"));
        return;
      }
      const rawKind = typeof event.data === "object" && event.data !== null
        ? Reflect.get(event.data, "kind")
        : undefined;
      if (rawKind === "result") {
        this.#emitProgress(job, "validating", Math.max(0.94, job.lastProgress));
      }
      if (!isExactResponseForAuthority(event.data, job.authority)) {
        this.#settle(job, new StudioBg3dObjWorkerClientError("protocol"));
        return;
      }
      const response = event.data;
      if (response.kind === "progress") {
        if (!this.#acceptProgress(job, response.stage, response.progress)) {
          this.#settle(job, new StudioBg3dObjWorkerClientError("protocol"));
        }
        return;
      }
      if (response.kind === "error") {
        this.#settle(job, new StudioBg3dObjWorkerClientError(response.code));
        return;
      }
      this.#emitProgress(job, "ready", 1);
      this.#settle(job, response.result);
    };
    job.handleMessage = handleMessage;
    job.handleWorkerFailure = handleWorkerFailure;
    try {
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleWorkerFailure);
      worker.addEventListener("messageerror", handleWorkerFailure);
    } catch (error) {
      this.#settle(job, new StudioBg3dObjWorkerClientError("worker-failed", { cause: error }));
      return;
    }
    job.executionTimeout = setTimeout(() => {
      if (this.#active === job) {
        this.#settle(job, new StudioBg3dObjWorkerClientError("timeout"));
      }
    }, this.#executionTimeoutMs);

    if (job.signal?.aborted) {
      this.#settle(job, new StudioBg3dObjWorkerClientError("aborted"));
      return;
    }
    try {
      worker.postMessage(job.request, studioBg3dObjWorkerRequestTransfers(job.request));
    } catch (error) {
      this.#settle(job, new StudioBg3dObjWorkerClientError("post-failed", { cause: error }));
    }
  }

  #acceptProgress(
    job: PendingJob,
    stage: StudioBg3dObjWorkerProgressStage,
    progress: number,
  ): boolean {
    const order = STAGE_ORDER[stage];
    if (order < job.stageOrder || progress < job.lastProgress || progress > 1) return false;
    this.#emitProgress(job, stage, progress);
    return true;
  }

  #emitProgress(
    job: PendingJob,
    stage: StudioBg3dObjWorkerClientProgressStage,
    progress: number,
  ): void {
    job.stageOrder = STAGE_ORDER[stage];
    job.lastProgress = progress;
    safely(() => job.onProgress?.({
      generationId: job.authority.generationId,
      requestId: job.authority.requestId,
      stage,
      progress,
    }));
  }

  #abort(job: PendingJob): void {
    if (!job.settled) this.#settle(job, new StudioBg3dObjWorkerClientError("aborted"));
  }

  #releaseAccounting(job: PendingJob): void {
    if (job.accountingReleased) return;
    job.accountingReleased = true;
    this.#ownedInputBytes -= job.ownedInputBytes;
  }

  #removeQueued(job: PendingJob): void {
    const index = this.#queue.indexOf(job);
    if (index >= 0) this.#queue.splice(index, 1);
  }

  #settle(
    job: PendingJob,
    outcome: StudioBg3dObjWorkerCanonicalResult | StudioBg3dObjWorkerClientError,
    continueQueue = true,
  ): void {
    if (job.settled) return;
    job.settled = true;
    if (job.executionTimeout !== null) clearTimeout(job.executionTimeout);
    if (job.queueTimeout !== null) clearTimeout(job.queueTimeout);
    if (job.abortListener) job.signal?.removeEventListener("abort", job.abortListener);
    this.#removeQueued(job);
    if (job.worker) {
      const worker = job.worker;
      if (job.handleMessage) safely(() => worker.removeEventListener("message", job.handleMessage!));
      if (job.handleWorkerFailure) {
        safely(() => worker.removeEventListener("error", job.handleWorkerFailure!));
        safely(() => worker.removeEventListener("messageerror", job.handleWorkerFailure!));
      }
      safely(() => worker.terminate());
      job.worker = null;
    }
    if (this.#active === job) this.#active = null;
    this.#releaseAccounting(job);
    if (outcome instanceof StudioBg3dObjWorkerClientError) job.reject(outcome);
    else job.resolve(outcome);
    if (continueQueue) queueMicrotask(() => this.#drain());
  }
}

let sharedClient: StudioBg3dObjWorkerClient | null = null;

export function parseStudioBg3dObjInWorker(
  input: StudioBg3dObjWorkerClientInput,
  options: StudioBg3dObjWorkerClientParseOptions = {},
): Promise<StudioBg3dObjWorkerCanonicalResult> {
  sharedClient ??= new StudioBg3dObjWorkerClient();
  return sharedClient.parse(input, options);
}

export function disposeSharedStudioBg3dObjWorkerClient(): void {
  sharedClient?.dispose();
  sharedClient = null;
}
