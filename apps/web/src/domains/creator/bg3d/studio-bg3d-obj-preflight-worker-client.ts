import {
  STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES,
  STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES,
  STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
  isStudioBg3dObjPreflightWorkerRequest,
  isStudioBg3dObjPreflightWorkerResponse,
  studioBg3dObjPreflightWorkerRequestTransfers,
  type StudioBg3dObjPreflightWorkerFailureCode,
  type StudioBg3dObjPreflightWorkerMtlEntry,
  type StudioBg3dObjPreflightWorkerMtlRequest,
  type StudioBg3dObjPreflightWorkerMtlResult,
  type StudioBg3dObjPreflightWorkerObjRequest,
  type StudioBg3dObjPreflightWorkerObjResult,
  type StudioBg3dObjPreflightWorkerRequest,
  type StudioBg3dObjPreflightWorkerResponse,
  type StudioBg3dObjPreflightWorkerResult,
  type StudioBg3dObjPreflightWorkerStage,
} from "./studio-bg3d-obj-preflight-worker-protocol";

export const STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_MAX_QUEUED_JOBS = 2;
export const STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_MAX_OWNED_INPUT_BYTES = 64 * 1024 * 1024;
export const STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
export const STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_DEFAULT_QUEUE_TIMEOUT_MS = 15_000;

export type StudioBg3dObjPreflightWorkerClientErrorCode =
  | StudioBg3dObjPreflightWorkerFailureCode
  | "aborted"
  | "capacity-exceeded"
  | "disposed"
  | "post-failed"
  | "queue-timeout"
  | "timeout"
  | "worker-failed"
  | "worker-unavailable";

export type StudioBg3dObjPreflightWorkerClientProgressStage =
  | "queued"
  | StudioBg3dObjPreflightWorkerStage
  | "validating"
  | "ready";

export interface StudioBg3dObjPreflightWorkerClientProgress {
  readonly generationId: number;
  readonly requestId: number;
  readonly stage: StudioBg3dObjPreflightWorkerClientProgressStage;
  readonly progress: number;
}

export interface StudioBg3dObjPreflightWorkerClientOptions {
  readonly workerFactory?: () => StudioBg3dObjPreflightWorkerLike | null;
  readonly executionTimeoutMs?: number;
  readonly queueTimeoutMs?: number;
}

export interface StudioBg3dObjPreflightWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dObjPreflightWorkerClientProgress) => void;
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioBg3dObjPreflightWorkerLike {
  postMessage(
    message: StudioBg3dObjPreflightWorkerRequest,
    transfer: Transferable[],
  ): void;
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

interface RequestAuthority {
  readonly generationId: number;
  readonly requestId: number;
  readonly kind: StudioBg3dObjPreflightWorkerRequest["kind"];
  readonly sourceByteLength: number;
  readonly materialPaths: readonly string[];
  readonly materialByteLengths: readonly number[];
}

interface PendingJob {
  readonly authority: RequestAuthority;
  readonly request: StudioBg3dObjPreflightWorkerRequest;
  readonly ownedInputBytes: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: StudioBg3dObjPreflightWorkerRunOptions["onProgress"];
  readonly resolve: (result: StudioBg3dObjPreflightWorkerResult) => void;
  readonly reject: (error: StudioBg3dObjPreflightWorkerClientError) => void;
  abortListener?: () => void;
  accountingReleased: boolean;
  executionTimeout: ReturnType<typeof setTimeout> | null;
  handleMessage?: (event: WorkerMessageEventLike) => void;
  handleWorkerFailure?: (event: WorkerErrorEventLike) => void;
  lastProgress: number;
  queueTimeout: ReturnType<typeof setTimeout> | null;
  settled: boolean;
  stageOrder: number;
  worker: StudioBg3dObjPreflightWorkerLike | null;
}

const STAGE_ORDER: Readonly<Record<StudioBg3dObjPreflightWorkerClientProgressStage, number>> = {
  queued: 0,
  decoding: 1,
  scanning: 2,
  validating: 3,
  ready: 4,
};

export class StudioBg3dObjPreflightWorkerClientError extends Error {
  constructor(
    readonly code: StudioBg3dObjPreflightWorkerClientErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = code === "aborted"
      ? "AbortError"
      : "StudioBg3dObjPreflightWorkerClientError";
  }
}

function createStudioBg3dObjPreflightModuleWorker(): StudioBg3dObjPreflightWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-bg3d-obj-preflight.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-bg3d-obj-preflight",
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

function createObjRequest(
  bytes: ArrayBuffer,
  requestId: number,
  generationId: number,
): StudioBg3dObjPreflightWorkerObjRequest {
  const request: StudioBg3dObjPreflightWorkerObjRequest = {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "preflight-obj",
    requestId,
    generationId,
    sourceByteLength: bytes.byteLength,
    bytes,
    budgets: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  };
  if (!isStudioBg3dObjPreflightWorkerRequest(request)) {
    throw new StudioBg3dObjPreflightWorkerClientError("protocol");
  }
  return request;
}

function createMtlRequest(
  materialLibraries: readonly StudioBg3dObjPreflightWorkerMtlEntry[],
  requestId: number,
  generationId: number,
): StudioBg3dObjPreflightWorkerMtlRequest {
  const request: StudioBg3dObjPreflightWorkerMtlRequest = {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "preflight-mtl",
    requestId,
    generationId,
    materialLibraries: materialLibraries.map((entry) => ({
      path: entry.path,
      sourceByteLength: entry.sourceByteLength,
      bytes: entry.bytes,
    })),
    budgets: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_BUDGETS,
  };
  if (!isStudioBg3dObjPreflightWorkerRequest(request)) {
    throw new StudioBg3dObjPreflightWorkerClientError("protocol");
  }
  return request;
}

function ownedInputByteLength(request: StudioBg3dObjPreflightWorkerRequest): number {
  if (request.kind === "preflight-obj") return request.sourceByteLength;
  let total = 0;
  for (const entry of request.materialLibraries) {
    if (total > Number.MAX_SAFE_INTEGER - entry.sourceByteLength) {
      throw new StudioBg3dObjPreflightWorkerClientError("protocol");
    }
    total += entry.sourceByteLength;
  }
  return total;
}

function authorityFor(request: StudioBg3dObjPreflightWorkerRequest): RequestAuthority {
  return request.kind === "preflight-obj"
    ? {
        generationId: request.generationId,
        requestId: request.requestId,
        kind: request.kind,
        sourceByteLength: request.sourceByteLength,
        materialPaths: [],
        materialByteLengths: [],
      }
    : {
        generationId: request.generationId,
        requestId: request.requestId,
        kind: request.kind,
        sourceByteLength: 0,
        materialPaths: request.materialLibraries.map((entry) => entry.path),
        materialByteLengths: request.materialLibraries.map((entry) => entry.sourceByteLength),
      };
}

function resultMatchesAuthority(
  result: StudioBg3dObjPreflightWorkerResult,
  authority: RequestAuthority,
): boolean {
  if (authority.kind === "preflight-obj") {
    return result.kind === "obj"
      && result.sourceByteLength === authority.sourceByteLength
      && result.bytes.byteLength === authority.sourceByteLength;
  }
  if (
    result.kind !== "mtl"
    || result.materialLibraries.length !== authority.materialPaths.length
  ) return false;
  return result.materialLibraries.every((entry, index) =>
    entry.path === authority.materialPaths[index]
    && entry.sourceByteLength === authority.materialByteLengths[index]
    && entry.bytes.byteLength === authority.materialByteLengths[index]);
}

/** Capacity-one transfer pipeline with a fresh Worker realm per admission scan. */
export class StudioBg3dObjPreflightWorkerClient {
  readonly #workerFactory: () => StudioBg3dObjPreflightWorkerLike | null;
  readonly #executionTimeoutMs: number;
  readonly #queueTimeoutMs: number;
  readonly #queue: PendingJob[] = [];
  #active: PendingJob | null = null;
  #disposed = false;
  #nextGenerationId = 1;
  #nextRequestId = 1;
  #ownedInputBytes = 0;

  constructor(options: StudioBg3dObjPreflightWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory ?? createStudioBg3dObjPreflightModuleWorker;
    this.#executionTimeoutMs = boundedTimeout(
      options.executionTimeoutMs,
      STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_DEFAULT_EXECUTION_TIMEOUT_MS,
      STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_DEFAULT_EXECUTION_TIMEOUT_MS,
    );
    this.#queueTimeoutMs = boundedTimeout(
      options.queueTimeoutMs,
      STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_DEFAULT_QUEUE_TIMEOUT_MS,
      STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_DEFAULT_QUEUE_TIMEOUT_MS,
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

  preflightObj(
    bytes: ArrayBuffer,
    options: StudioBg3dObjPreflightWorkerRunOptions = {},
  ): Promise<StudioBg3dObjPreflightWorkerObjResult> {
    let request: StudioBg3dObjPreflightWorkerObjRequest;
    try {
      request = createObjRequest(
        bytes,
        this.#allocateRequestId(),
        this.#allocateGenerationId(),
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(request, options).then((result) => {
      if (result.kind !== "obj") {
        throw new StudioBg3dObjPreflightWorkerClientError("protocol");
      }
      return result;
    });
  }

  preflightMtl(
    materialLibraries: readonly StudioBg3dObjPreflightWorkerMtlEntry[],
    options: StudioBg3dObjPreflightWorkerRunOptions = {},
  ): Promise<StudioBg3dObjPreflightWorkerMtlResult> {
    let request: StudioBg3dObjPreflightWorkerMtlRequest;
    try {
      request = createMtlRequest(
        materialLibraries,
        this.#allocateRequestId(),
        this.#allocateGenerationId(),
      );
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(request, options).then((result) => {
      if (result.kind !== "mtl") {
        throw new StudioBg3dObjPreflightWorkerClientError("protocol");
      }
      return result;
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    if (active) {
      this.#settle(
        active,
        new StudioBg3dObjPreflightWorkerClientError("disposed"),
        false,
      );
    }
    while (this.#queue.length > 0) {
      const queued = this.#queue.shift();
      if (queued) {
        this.#settle(
          queued,
          new StudioBg3dObjPreflightWorkerClientError("disposed"),
          false,
        );
      }
    }
    this.#active = null;
  }

  #allocateGenerationId(): number {
    const current = this.#nextGenerationId;
    this.#nextGenerationId = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
    return current;
  }

  #allocateRequestId(): number {
    const current = this.#nextRequestId;
    this.#nextRequestId = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
    return current;
  }

  #enqueue(
    request: StudioBg3dObjPreflightWorkerRequest,
    options: StudioBg3dObjPreflightWorkerRunOptions,
  ): Promise<StudioBg3dObjPreflightWorkerResult> {
    if (this.#disposed) {
      return Promise.reject(new StudioBg3dObjPreflightWorkerClientError("disposed"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new StudioBg3dObjPreflightWorkerClientError("aborted"));
    }
    let inputBytes: number;
    try {
      inputBytes = ownedInputByteLength(request);
    } catch (error) {
      return Promise.reject(error);
    }
    const totalJobs = this.#queue.length + (this.#active ? 1 : 0);
    if (
      totalJobs >= STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_MAX_QUEUED_JOBS + 1
      || inputBytes
        > STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_MAX_OWNED_INPUT_BYTES - this.#ownedInputBytes
    ) {
      return Promise.reject(
        new StudioBg3dObjPreflightWorkerClientError("capacity-exceeded"),
      );
    }

    this.#ownedInputBytes += inputBytes;
    return new Promise((resolve, reject) => {
      const job: PendingJob = {
        authority: authorityFor(request),
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
        this.#settle(job, new StudioBg3dObjPreflightWorkerClientError("aborted"));
        return;
      }
      this.#queue.push(job);
      job.queueTimeout = setTimeout(() => {
        if (!job.settled && this.#active !== job) {
          this.#settle(
            job,
            new StudioBg3dObjPreflightWorkerClientError("queue-timeout"),
          );
        }
      }, this.#queueTimeoutMs);
      this.#emitProgress(job, "queued", 0);
      this.#drain();
    });
  }

  #drain(): void {
    if (this.#disposed || this.#active) return;
    let job = this.#queue.shift();
    while (job?.settled) job = this.#queue.shift();
    if (!job) return;
    if (job.signal?.aborted) {
      this.#settle(job, new StudioBg3dObjPreflightWorkerClientError("aborted"));
      return;
    }
    this.#active = job;
    if (job.queueTimeout) {
      clearTimeout(job.queueTimeout);
      job.queueTimeout = null;
    }

    let worker: StudioBg3dObjPreflightWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      this.#settle(
        job,
        new StudioBg3dObjPreflightWorkerClientError("worker-unavailable", { cause: error }),
      );
      return;
    }
    if (!worker) {
      this.#settle(
        job,
        new StudioBg3dObjPreflightWorkerClientError("worker-unavailable"),
      );
      return;
    }
    job.worker = worker;

    const handleWorkerFailure = (event: WorkerErrorEventLike): void => {
      event.preventDefault?.();
      if (this.#active === job) {
        this.#settle(
          job,
          new StudioBg3dObjPreflightWorkerClientError("worker-failed"),
        );
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
        // A late result from an obsolete generation has no authority over the active request.
        return;
      }
      if (!identity || !isStudioBg3dObjPreflightWorkerResponse(event.data)) {
        this.#settle(job, new StudioBg3dObjPreflightWorkerClientError("protocol"));
        return;
      }
      const response: StudioBg3dObjPreflightWorkerResponse = event.data;
      if (response.kind === "progress") {
        if (!this.#acceptProgress(job, response.stage, response.progress)) {
          this.#settle(job, new StudioBg3dObjPreflightWorkerClientError("protocol"));
        }
        return;
      }
      if (response.kind === "error") {
        this.#settle(
          job,
          new StudioBg3dObjPreflightWorkerClientError(response.code),
        );
        return;
      }
      if (!resultMatchesAuthority(response.result, job.authority)) {
        this.#settle(job, new StudioBg3dObjPreflightWorkerClientError("protocol"));
        return;
      }
      this.#emitProgress(job, "validating", 0.94);
      this.#emitProgress(job, "ready", 1);
      this.#settle(job, response.result);
    };
    job.handleMessage = handleMessage;
    job.handleWorkerFailure = handleWorkerFailure;
    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleWorkerFailure);
    worker.addEventListener("messageerror", handleWorkerFailure);
    job.executionTimeout = setTimeout(() => {
      if (this.#active === job) {
        this.#settle(job, new StudioBg3dObjPreflightWorkerClientError("timeout"));
      }
    }, this.#executionTimeoutMs);

    try {
      worker.postMessage(
        job.request,
        studioBg3dObjPreflightWorkerRequestTransfers(job.request),
      );
    } catch (error) {
      this.#settle(
        job,
        new StudioBg3dObjPreflightWorkerClientError("post-failed", { cause: error }),
      );
    }
  }

  #acceptProgress(
    job: PendingJob,
    stage: StudioBg3dObjPreflightWorkerStage,
    progress: number,
  ): boolean {
    const order = STAGE_ORDER[stage];
    if (order < job.stageOrder || progress < job.lastProgress || progress >= 1) return false;
    job.stageOrder = order;
    job.lastProgress = progress;
    this.#emitProgress(job, stage, progress);
    return true;
  }

  #emitProgress(
    job: PendingJob,
    stage: StudioBg3dObjPreflightWorkerClientProgressStage,
    progress: number,
  ): void {
    const order = STAGE_ORDER[stage];
    if (order < job.stageOrder || progress < job.lastProgress) return;
    job.stageOrder = order;
    job.lastProgress = progress;
    safely(() => job.onProgress?.({
      generationId: job.authority.generationId,
      requestId: job.authority.requestId,
      stage,
      progress,
    }));
  }

  #abort(job: PendingJob): void {
    this.#settle(job, new StudioBg3dObjPreflightWorkerClientError("aborted"));
  }

  #settle(
    job: PendingJob,
    outcome: StudioBg3dObjPreflightWorkerResult | StudioBg3dObjPreflightWorkerClientError,
    drain = true,
  ): void {
    if (job.settled) return;
    job.settled = true;
    if (job.executionTimeout) clearTimeout(job.executionTimeout);
    if (job.queueTimeout) clearTimeout(job.queueTimeout);
    job.executionTimeout = null;
    job.queueTimeout = null;
    if (job.abortListener) {
      job.signal?.removeEventListener("abort", job.abortListener);
      job.abortListener = undefined;
    }
    const worker = job.worker;
    if (worker) {
      if (job.handleMessage) worker.removeEventListener("message", job.handleMessage);
      if (job.handleWorkerFailure) {
        worker.removeEventListener("error", job.handleWorkerFailure);
        worker.removeEventListener("messageerror", job.handleWorkerFailure);
      }
      safely(() => worker.terminate());
      job.worker = null;
    }
    if (this.#active === job) this.#active = null;
    else {
      const queuedIndex = this.#queue.indexOf(job);
      if (queuedIndex >= 0) this.#queue.splice(queuedIndex, 1);
    }
    if (!job.accountingReleased) {
      job.accountingReleased = true;
      this.#ownedInputBytes = Math.max(0, this.#ownedInputBytes - job.ownedInputBytes);
    }
    if (outcome instanceof StudioBg3dObjPreflightWorkerClientError) job.reject(outcome);
    else job.resolve(outcome);
    if (drain) this.#drain();
  }
}

let sharedClient: StudioBg3dObjPreflightWorkerClient | null = null;

function sharedStudioBg3dObjPreflightWorkerClient(): StudioBg3dObjPreflightWorkerClient {
  sharedClient ??= new StudioBg3dObjPreflightWorkerClient();
  return sharedClient;
}

export function preflightStudioBg3dObjBytesInWorker(
  bytes: ArrayBuffer,
  options: StudioBg3dObjPreflightWorkerRunOptions = {},
): Promise<StudioBg3dObjPreflightWorkerObjResult> {
  if (bytes.byteLength <= 0 || bytes.byteLength > STUDIO_BG3D_OBJ_PREFLIGHT_MAX_OBJ_BYTES) {
    return Promise.reject(new StudioBg3dObjPreflightWorkerClientError("protocol"));
  }
  return sharedStudioBg3dObjPreflightWorkerClient().preflightObj(bytes, options);
}

export function preflightStudioBg3dMtlBytesInWorker(
  materialLibraries: readonly StudioBg3dObjPreflightWorkerMtlEntry[],
  options: StudioBg3dObjPreflightWorkerRunOptions = {},
): Promise<StudioBg3dObjPreflightWorkerMtlResult> {
  let totalBytes = 0;
  for (const entry of materialLibraries) {
    if (totalBytes > STUDIO_BG3D_OBJ_PREFLIGHT_MAX_MTL_BYTES - entry.sourceByteLength) {
      return Promise.reject(new StudioBg3dObjPreflightWorkerClientError("protocol"));
    }
    totalBytes += entry.sourceByteLength;
  }
  return sharedStudioBg3dObjPreflightWorkerClient().preflightMtl(materialLibraries, options);
}

export function disposeSharedStudioBg3dObjPreflightWorkerClient(): void {
  sharedClient?.dispose();
  sharedClient = null;
}
