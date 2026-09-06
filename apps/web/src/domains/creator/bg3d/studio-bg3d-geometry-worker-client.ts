import {
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_INPUT_BYTES,
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_TRIANGLES,
  STUDIO_BG3D_GEOMETRY_WORKER_MAX_VERTICES,
  STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
  hasValidStudioBg3dCanonicalGeometryNumbers,
  isStudioBg3dCanonicalGeometryPayload,
  isStudioBg3dGeometryWorkerResponse,
  studioBg3dGeometryWorkerRequestTransfers,
  type StudioBg3dCanonicalGeometryPayload,
  type StudioBg3dGeometryWorkerFailureCode,
  type StudioBg3dGeometryWorkerFormat,
  type StudioBg3dGeometryWorkerRequest,
  type StudioBg3dGeometryWorkerStage,
} from "./studio-bg3d-geometry-worker-protocol";

export const STUDIO_BG3D_GEOMETRY_WORKER_MAX_QUEUED_JOBS = 8;
export const STUDIO_BG3D_GEOMETRY_WORKER_DEFAULT_TIMEOUT_MS = 30_000;

export type StudioBg3dGeometryWorkerClientErrorCode =
  | StudioBg3dGeometryWorkerFailureCode
  | "aborted"
  | "capacity-exceeded"
  | "disposed"
  | "protocol"
  | "timeout"
  | "worker-failed"
  | "worker-unavailable";

export type StudioBg3dGeometryWorkerClientProgressStage =
  | "queued"
  | StudioBg3dGeometryWorkerStage
  | "validating"
  | "ready";

export interface StudioBg3dGeometryWorkerClientProgress {
  readonly generationId: number;
  readonly requestId: number;
  readonly stage: StudioBg3dGeometryWorkerClientProgressStage;
  readonly progress: number;
}

export interface StudioBg3dGeometryWorkerClientParseOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioBg3dGeometryWorkerClientProgress) => void;
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioBg3dGeometryWorkerLike {
  postMessage(message: StudioBg3dGeometryWorkerRequest, transfer: Transferable[]): void;
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

export interface StudioBg3dGeometryWorkerClientOptions {
  readonly workerFactory?: () => StudioBg3dGeometryWorkerLike | null;
  readonly timeoutMs?: number;
}

interface PendingJob {
  readonly format: StudioBg3dGeometryWorkerFormat;
  readonly bytes: ArrayBuffer;
  readonly generationId: number;
  readonly requestId: number;
  readonly signal?: AbortSignal;
  readonly onProgress?: StudioBg3dGeometryWorkerClientParseOptions["onProgress"];
  readonly resolve: (result: StudioBg3dCanonicalGeometryPayload) => void;
  readonly reject: (error: StudioBg3dGeometryWorkerClientError) => void;
  abortListener?: () => void;
  lastProgress: number;
  stageOrder: number;
  settled: boolean;
  worker: StudioBg3dGeometryWorkerLike | null;
  timeout: ReturnType<typeof setTimeout> | null;
  handleMessage?: (event: WorkerMessageEventLike) => void;
  handleWorkerFailure?: (event: WorkerErrorEventLike) => void;
}

const STAGE_ORDER: Readonly<Record<StudioBg3dGeometryWorkerClientProgressStage, number>> = {
  queued: 0,
  parsing: 1,
  canonicalizing: 2,
  validating: 3,
  ready: 4,
};

export class StudioBg3dGeometryWorkerClientError extends Error {
  constructor(readonly code: StudioBg3dGeometryWorkerClientErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = code === "aborted" ? "AbortError" : "StudioBg3dGeometryWorkerClientError";
  }
}

function createStudioBg3dGeometryModuleWorker(): StudioBg3dGeometryWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-bg3d-geometry.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-bg3d-geometry",
  });
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return STUDIO_BG3D_GEOMETRY_WORKER_DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(value)) return STUDIO_BG3D_GEOMETRY_WORKER_DEFAULT_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1, Math.trunc(value)));
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function responseIdentity(value: unknown): { readonly generationId: number; readonly requestId: number } | null {
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
    // Cleanup and observational callbacks cannot change job ownership.
  }
}

function validateInput(format: StudioBg3dGeometryWorkerFormat, bytes: ArrayBuffer): void {
  if ((format !== "ply" && format !== "stl") || !(bytes instanceof ArrayBuffer)) {
    throw new StudioBg3dGeometryWorkerClientError("protocol");
  }
  if (bytes.byteLength <= 0 || bytes.byteLength > STUDIO_BG3D_GEOMETRY_WORKER_MAX_INPUT_BYTES) {
    throw new StudioBg3dGeometryWorkerClientError("protocol");
  }
}

/**
 * Capacity-one parser. A fresh Worker realm is used for each job, which both bounds concurrency and
 * guarantees that a parser crash, timeout, or abort cannot poison the following import.
 */
export class StudioBg3dGeometryWorkerClient {
  readonly #workerFactory: () => StudioBg3dGeometryWorkerLike | null;
  readonly #timeoutMs: number;
  readonly #queue: PendingJob[] = [];
  #active: PendingJob | null = null;
  #disposed = false;
  #nextGenerationId = 1;
  #nextRequestId = 1;

  constructor(options: StudioBg3dGeometryWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory ?? createStudioBg3dGeometryModuleWorker;
    this.#timeoutMs = boundedTimeout(options.timeoutMs);
  }

  parse(
    format: StudioBg3dGeometryWorkerFormat,
    bytes: ArrayBuffer,
    options: StudioBg3dGeometryWorkerClientParseOptions = {},
  ): Promise<StudioBg3dCanonicalGeometryPayload> {
    try {
      validateInput(format, bytes);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.#disposed) {
      return Promise.reject(new StudioBg3dGeometryWorkerClientError("disposed"));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new StudioBg3dGeometryWorkerClientError("aborted"));
    }
    if (this.#queue.length + (this.#active ? 1 : 0) >= STUDIO_BG3D_GEOMETRY_WORKER_MAX_QUEUED_JOBS + 1) {
      return Promise.reject(new StudioBg3dGeometryWorkerClientError("capacity-exceeded"));
    }

    const generationId = this.#allocateGenerationId();
    const requestId = this.#allocateRequestId();
    return new Promise((resolve, reject) => {
      const job: PendingJob = {
        format,
        bytes,
        generationId,
        requestId,
        signal: options.signal,
        onProgress: options.onProgress,
        resolve,
        reject,
        lastProgress: 0,
        stageOrder: 0,
        settled: false,
        worker: null,
        timeout: null,
      };
      job.abortListener = () => this.#abort(job);
      options.signal?.addEventListener("abort", job.abortListener, { once: true });
      if (options.signal?.aborted) {
        this.#settle(job, new StudioBg3dGeometryWorkerClientError("aborted"));
        return;
      }
      this.#queue.push(job);
      this.#emitProgress(job, "queued", 0);
      this.#drain();
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const active = this.#active;
    if (active) this.#settle(active, new StudioBg3dGeometryWorkerClientError("disposed"), false);
    while (this.#queue.length > 0) {
      const queued = this.#queue.shift();
      if (queued) this.#settle(queued, new StudioBg3dGeometryWorkerClientError("disposed"), false);
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

  #drain(): void {
    if (this.#disposed || this.#active) return;
    let job = this.#queue.shift();
    while (job?.settled) job = this.#queue.shift();
    if (!job) return;
    if (job.signal?.aborted) {
      this.#settle(job, new StudioBg3dGeometryWorkerClientError("aborted"));
      return;
    }
    this.#active = job;

    let worker: StudioBg3dGeometryWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      this.#settle(job, new StudioBg3dGeometryWorkerClientError("worker-unavailable", { cause: error }));
      return;
    }
    if (!worker) {
      this.#settle(job, new StudioBg3dGeometryWorkerClientError("worker-unavailable"));
      return;
    }
    job.worker = worker;

    const handleWorkerFailure = (event: WorkerErrorEventLike): void => {
      event.preventDefault?.();
      if (this.#active === job) {
        this.#settle(job, new StudioBg3dGeometryWorkerClientError("worker-failed"));
      }
    };
    const handleMessage = (event: WorkerMessageEventLike): void => {
      if (this.#active !== job || job.settled) return;
      const identity = responseIdentity(event.data);
      if (
        identity
        && (identity.generationId !== job.generationId || identity.requestId !== job.requestId)
      ) {
        // A late response from an obsolete generation has no authority over the active job.
        return;
      }
      if (!identity || !isStudioBg3dGeometryWorkerResponse(event.data)) {
        this.#settle(job, new StudioBg3dGeometryWorkerClientError("protocol"));
        return;
      }
      const response = event.data;
      if (response.kind === "progress") {
        if (!this.#acceptProgress(job, response.stage, response.progress)) {
          this.#settle(job, new StudioBg3dGeometryWorkerClientError("protocol"));
        }
        return;
      }
      if (response.kind === "error") {
        this.#settle(job, new StudioBg3dGeometryWorkerClientError(response.code));
        return;
      }
      if (
        !isStudioBg3dCanonicalGeometryPayload(response.result, job.format)
        || !hasValidStudioBg3dCanonicalGeometryNumbers(response.result)
      ) {
        this.#settle(job, new StudioBg3dGeometryWorkerClientError("protocol"));
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
    job.timeout = setTimeout(() => {
      if (this.#active === job) this.#settle(job, new StudioBg3dGeometryWorkerClientError("timeout"));
    }, this.#timeoutMs);

    const request: StudioBg3dGeometryWorkerRequest = {
      version: STUDIO_BG3D_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "parse",
      requestId: job.requestId,
      generationId: job.generationId,
      format: job.format,
      sourceByteLength: job.bytes.byteLength,
      bytes: job.bytes,
      budgets: {
        maxOutputBytes: STUDIO_BG3D_GEOMETRY_WORKER_MAX_OUTPUT_BYTES,
        maxTriangles: STUDIO_BG3D_GEOMETRY_WORKER_MAX_TRIANGLES,
        maxVertices: STUDIO_BG3D_GEOMETRY_WORKER_MAX_VERTICES,
      },
    };
    if (job.signal?.aborted) {
      this.#settle(job, new StudioBg3dGeometryWorkerClientError("aborted"));
      return;
    }
    try {
      worker.postMessage(request, studioBg3dGeometryWorkerRequestTransfers(request));
    } catch (error) {
      this.#settle(job, new StudioBg3dGeometryWorkerClientError("worker-failed", { cause: error }));
    }
  }

  #acceptProgress(
    job: PendingJob,
    stage: StudioBg3dGeometryWorkerStage,
    progress: number,
  ): boolean {
    const order = STAGE_ORDER[stage];
    if (order < job.stageOrder || progress < job.lastProgress || progress >= 1) return false;
    this.#emitProgress(job, stage, progress);
    return true;
  }

  #emitProgress(
    job: PendingJob,
    stage: StudioBg3dGeometryWorkerClientProgressStage,
    progress: number,
  ): void {
    job.stageOrder = STAGE_ORDER[stage];
    job.lastProgress = progress;
    safely(() => job.onProgress?.({
      generationId: job.generationId,
      requestId: job.requestId,
      stage,
      progress,
    }));
  }

  #abort(job: PendingJob): void {
    if (job.settled) return;
    this.#settle(job, new StudioBg3dGeometryWorkerClientError("aborted"));
  }

  #settle(
    job: PendingJob,
    outcome: StudioBg3dCanonicalGeometryPayload | StudioBg3dGeometryWorkerClientError,
    continueQueue = true,
  ): void {
    if (job.settled) return;
    job.settled = true;
    if (job.timeout !== null) clearTimeout(job.timeout);
    if (job.abortListener) job.signal?.removeEventListener("abort", job.abortListener);
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
    if (outcome instanceof StudioBg3dGeometryWorkerClientError) job.reject(outcome);
    else job.resolve(outcome);
    if (continueQueue) queueMicrotask(() => this.#drain());
  }
}

let sharedClient: StudioBg3dGeometryWorkerClient | null = null;

export function parseStudioBg3dGeometryInWorker(
  format: StudioBg3dGeometryWorkerFormat,
  bytes: ArrayBuffer,
  options: StudioBg3dGeometryWorkerClientParseOptions = {},
): Promise<StudioBg3dCanonicalGeometryPayload> {
  sharedClient ??= new StudioBg3dGeometryWorkerClient();
  return sharedClient.parse(format, bytes, options);
}

export function disposeSharedStudioBg3dGeometryWorkerClient(): void {
  sharedClient?.dispose();
  sharedClient = null;
}
