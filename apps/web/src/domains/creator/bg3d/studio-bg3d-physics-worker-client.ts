import {
  STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
  createStudioBg3dPhysicsTimelineResult,
  isStudioBg3dPhysicsTimelineWorkerResponseMessage,
  normalizeStudioBg3dPhysicsTimelineInput,
  type NormalizedStudioBg3dPhysicsTimelineInput,
  type StudioBg3dPhysicsTimelineInput,
  type StudioBg3dPhysicsTimelineResult,
  type StudioBg3dPhysicsTimelineWorkerResponseMessage,
  type StudioBg3dPhysicsTimelineWorkerRunMessage,
} from "./studio-bg3d-physics-timeline";

export const STUDIO_BG3D_PHYSICS_TIMELINE_WORKER_TIMEOUT_MS = 60_000;

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioBg3dPhysicsTimelineWorkerLike {
  postMessage(message: StudioBg3dPhysicsTimelineWorkerRunMessage): void;
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

export type StudioBg3dPhysicsTimelineWorkerFactory =
  () => StudioBg3dPhysicsTimelineWorkerLike | null;

export interface StudioBg3dPhysicsTimelineWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface StudioBg3dPhysicsTimelineWorkerSessionOptions {
  /** Omitted creates a lazy Vite module Worker; injection keeps tests and non-browser hosts isolated. */
  readonly workerFactory?: StudioBg3dPhysicsTimelineWorkerFactory;
}

export interface StudioBg3dPhysicsTimelineWorkerOptions
  extends StudioBg3dPhysicsTimelineWorkerRunOptions,
  StudioBg3dPhysicsTimelineWorkerSessionOptions {}

export interface StudioBg3dPhysicsTimelineWorkerSession {
  readonly disposed: boolean;
  run(
    inputValue: StudioBg3dPhysicsTimelineInput | unknown,
    options?: StudioBg3dPhysicsTimelineWorkerRunOptions,
  ): Promise<StudioBg3dPhysicsTimelineResult>;
  dispose(): void;
}

export type StudioBg3dPhysicsTimelineWorkerErrorCode =
  | "aborted"
  | "invalid-request"
  | "protocol"
  | "simulation-failed"
  | "timeout"
  | "worker-failed";

export class StudioBg3dPhysicsTimelineWorkerError extends Error {
  constructor(readonly code: StudioBg3dPhysicsTimelineWorkerErrorCode) {
    super(`studio-bg3d-physics-timeline-worker:${code}`);
    this.name = code === "aborted" ? "AbortError" : "StudioBg3dPhysicsTimelineWorkerError";
  }
}

/** Vite discovers this exact URL expression and emits the physics engine only in a Worker graph. */
export function createStudioBg3dPhysicsTimelineModuleWorker():
  StudioBg3dPhysicsTimelineWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-bg3d-physics.worker.ts", import.meta.url),
    { name: "toonspectrum-bg3d-physics-timeline", type: "module" },
  );
}

let nextRequestId = 1;

function allocateRequestId(): number {
  const requestId = nextRequestId;
  nextRequestId = requestId >= Number.MAX_SAFE_INTEGER ? 1 : requestId + 1;
  return requestId;
}

function isResponseForRequest(value: unknown, requestId: number): boolean {
  try {
    return typeof value === "object" && value !== null &&
      Reflect.get(value, "requestId") === requestId;
  } catch {
    return false;
  }
}

function matchingNodeIds(
  response: StudioBg3dPhysicsTimelineWorkerResponseMessage & { readonly kind: "result" },
  input: NormalizedStudioBg3dPhysicsTimelineInput,
): boolean {
  return response.nodeIds.length === input.dynamicNodeIds.length &&
    response.nodeIds.every((nodeId, index) => nodeId === input.dynamicNodeIds[index]);
}

function resultFromResponse(
  response: StudioBg3dPhysicsTimelineWorkerResponseMessage & { readonly kind: "result" },
  input: NormalizedStudioBg3dPhysicsTimelineInput,
): StudioBg3dPhysicsTimelineResult | null {
  if (
    !matchingNodeIds(response, input) ||
    response.frameCount !== input.frameCount ||
    response.durationSeconds !== input.durationSeconds
  ) return null;
  return createStudioBg3dPhysicsTimelineResult(
    response.nodeIds,
    response.frameCount,
    response.durationSeconds,
    response.stepSeconds,
    response.transformsBuffer,
  );
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_BG3D_PHYSICS_TIMELINE_WORKER_TIMEOUT_MS;
  return Math.max(100, Math.min(120_000, Math.floor(value ?? 0)));
}

type TimelineWorkerJobState = "active" | "queued" | "settled";

interface TimelineWorkerJob {
  readonly input: NormalizedStudioBg3dPhysicsTimelineInput;
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly resolve: (result: StudioBg3dPhysicsTimelineResult) => void;
  readonly reject: (error: StudioBg3dPhysicsTimelineWorkerError) => void;
  readonly handleAbort: () => void;
  state: TimelineWorkerJobState;
  requestId: number | null;
  timeout: ReturnType<typeof setTimeout> | null;
}

interface TimelineWorkerBinding {
  readonly worker: StudioBg3dPhysicsTimelineWorkerLike;
  readonly epoch: number;
  readonly handleMessage: (event: WorkerMessageEventLike) => void;
  readonly handleFailure: (event: WorkerErrorEventLike) => void;
}

class StudioBg3dPhysicsTimelineWorkerSessionImpl
implements StudioBg3dPhysicsTimelineWorkerSession {
  private readonly workerFactory: StudioBg3dPhysicsTimelineWorkerFactory;
  private readonly queue: TimelineWorkerJob[] = [];
  private workerBinding: TimelineWorkerBinding | null = null;
  private activeJob: TimelineWorkerJob | null = null;
  private workerEpoch = 0;
  private pumping = false;
  private isDisposed = false;

  constructor(options: StudioBg3dPhysicsTimelineWorkerSessionOptions) {
    this.workerFactory = options.workerFactory ?? createStudioBg3dPhysicsTimelineModuleWorker;
  }

  get disposed(): boolean {
    return this.isDisposed;
  }

  run(
    inputValue: StudioBg3dPhysicsTimelineInput | unknown,
    options: StudioBg3dPhysicsTimelineWorkerRunOptions = {},
  ): Promise<StudioBg3dPhysicsTimelineResult> {
    if (this.isDisposed || options.signal?.aborted) {
      return Promise.reject(new StudioBg3dPhysicsTimelineWorkerError("aborted"));
    }
    const input = normalizeStudioBg3dPhysicsTimelineInput(inputValue);
    if (!input) {
      return Promise.reject(new StudioBg3dPhysicsTimelineWorkerError("invalid-request"));
    }

    return new Promise((resolve, reject) => {
      const handleAbort = () => this.abortJob(job);
      const job: TimelineWorkerJob = {
        input,
        signal: options.signal,
        timeoutMs: boundedTimeout(options.timeoutMs),
        resolve,
        reject,
        handleAbort,
        state: "queued",
        requestId: null,
        timeout: null,
      };
      this.queue.push(job);
      job.signal?.addEventListener("abort", handleAbort, { once: true });
      if (job.signal?.aborted) {
        this.abortJob(job);
        return;
      }
      this.pump();
    });
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;

    const activeJob = this.activeJob;
    this.activeJob = null;
    if (activeJob) {
      this.settleJob(
        activeJob,
        null,
        new StudioBg3dPhysicsTimelineWorkerError("aborted"),
      );
    }
    for (const queuedJob of this.queue.splice(0)) {
      this.settleJob(
        queuedJob,
        null,
        new StudioBg3dPhysicsTimelineWorkerError("aborted"),
      );
    }
    this.recycleWorker();
  }

  private pump(): void {
    if (this.pumping || this.isDisposed || this.activeJob) return;
    this.pumping = true;
    try {
      while (!this.isDisposed && !this.activeJob && this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job || job.state !== "queued") continue;
        if (job.signal?.aborted) {
          this.settleJob(
            job,
            null,
            new StudioBg3dPhysicsTimelineWorkerError("aborted"),
          );
          continue;
        }

        const binding = this.ensureWorker();
        if (!binding) {
          this.settleJob(
            job,
            null,
            new StudioBg3dPhysicsTimelineWorkerError("worker-failed"),
          );
          continue;
        }

        const requestId = allocateRequestId();
        const request: StudioBg3dPhysicsTimelineWorkerRunMessage = {
          version: STUDIO_BG3D_PHYSICS_TIMELINE_PROTOCOL_VERSION,
          kind: "run",
          requestId,
          input: job.input,
        };
        job.state = "active";
        job.requestId = requestId;
        this.activeJob = job;
        job.timeout = setTimeout(
          () => this.failActiveJob(job, "timeout", true),
          job.timeoutMs,
        );
        try {
          binding.worker.postMessage(request);
        } catch {
          this.failActiveJob(job, "worker-failed", true);
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  private ensureWorker(): TimelineWorkerBinding | null {
    if (this.workerBinding) return this.workerBinding;

    let worker: StudioBg3dPhysicsTimelineWorkerLike | null;
    try {
      worker = this.workerFactory();
    } catch {
      return null;
    }
    if (!worker) return null;

    const epoch = this.workerEpoch + 1;
    this.workerEpoch = epoch;
    const handleMessage = (event: WorkerMessageEventLike) => {
      this.handleWorkerMessage(epoch, event);
    };
    const handleFailure = (event: WorkerErrorEventLike) => {
      this.handleWorkerFailure(epoch, event);
    };
    const binding: TimelineWorkerBinding = {
      worker,
      epoch,
      handleMessage,
      handleFailure,
    };
    try {
      worker.addEventListener("message", handleMessage);
      worker.addEventListener("error", handleFailure);
      worker.addEventListener("messageerror", handleFailure);
    } catch {
      this.detachAndTerminateWorker(binding);
      return null;
    }
    this.workerBinding = binding;
    return binding;
  }

  private handleWorkerMessage(epoch: number, event: WorkerMessageEventLike): void {
    if (this.workerBinding?.epoch !== epoch) return;
    const job = this.activeJob;
    const requestId = job?.requestId;
    if (
      !job || requestId === null || requestId === undefined ||
      !isResponseForRequest(event.data, requestId)
    ) return;
    if (!isStudioBg3dPhysicsTimelineWorkerResponseMessage(event.data)) {
      this.failActiveJob(job, "protocol", true);
      return;
    }
    if (event.data.kind === "failure") {
      this.failActiveJob(job, event.data.code, true);
      return;
    }
    const result = resultFromResponse(event.data, job.input);
    if (!result) {
      this.failActiveJob(job, "protocol", true);
      return;
    }
    this.finishActiveJob(job, result, null, false);
  }

  private handleWorkerFailure(epoch: number, event: WorkerErrorEventLike): void {
    if (this.workerBinding?.epoch !== epoch) return;
    event.preventDefault?.();
    const job = this.activeJob;
    if (!job) {
      this.recycleWorker();
      return;
    }
    this.failActiveJob(job, "worker-failed", true);
  }

  private abortJob(job: TimelineWorkerJob): void {
    if (job.state === "settled") return;
    if (job.state === "active") {
      this.failActiveJob(job, "aborted", true);
      return;
    }
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    this.settleJob(
      job,
      null,
      new StudioBg3dPhysicsTimelineWorkerError("aborted"),
    );
    this.pump();
  }

  private failActiveJob(
    job: TimelineWorkerJob,
    code: StudioBg3dPhysicsTimelineWorkerErrorCode,
    recycleWorker: boolean,
  ): void {
    this.finishActiveJob(
      job,
      null,
      new StudioBg3dPhysicsTimelineWorkerError(code),
      recycleWorker,
    );
  }

  private finishActiveJob(
    job: TimelineWorkerJob,
    result: StudioBg3dPhysicsTimelineResult | null,
    error: StudioBg3dPhysicsTimelineWorkerError | null,
    recycleWorker: boolean,
  ): void {
    if (this.activeJob !== job || job.state !== "active") return;
    this.activeJob = null;
    if (recycleWorker) this.recycleWorker();
    this.settleJob(job, result, error);
    this.pump();
  }

  private settleJob(
    job: TimelineWorkerJob,
    result: StudioBg3dPhysicsTimelineResult | null,
    error: StudioBg3dPhysicsTimelineWorkerError | null,
  ): void {
    if (job.state === "settled") return;
    job.state = "settled";
    if (job.timeout !== null) {
      clearTimeout(job.timeout);
      job.timeout = null;
    }
    job.signal?.removeEventListener("abort", job.handleAbort);
    if (error) {
      job.reject(error);
    } else if (result) {
      job.resolve(result);
    } else {
      job.reject(new StudioBg3dPhysicsTimelineWorkerError("worker-failed"));
    }
  }

  private recycleWorker(): void {
    const binding = this.workerBinding;
    this.workerBinding = null;
    if (binding) this.detachAndTerminateWorker(binding);
  }

  private detachAndTerminateWorker(binding: TimelineWorkerBinding): void {
    try {
      binding.worker.removeEventListener("message", binding.handleMessage);
      binding.worker.removeEventListener("error", binding.handleFailure);
      binding.worker.removeEventListener("messageerror", binding.handleFailure);
    } finally {
      binding.worker.terminate();
    }
  }
}

/**
 * Creates a serial physics timeline session. Successful jobs reuse the same Worker and its Rapier
 * WASM initialization. Abort, timeout, protocol, and Worker failures rotate the Worker before the
 * next queued job, and dispose terminates it permanently.
 */
export function createStudioBg3dPhysicsTimelineWorkerSession(
  options: StudioBg3dPhysicsTimelineWorkerSessionOptions = {},
): StudioBg3dPhysicsTimelineWorkerSession {
  return new StudioBg3dPhysicsTimelineWorkerSessionImpl(options);
}

/**
 * Runs one bounded deterministic physics bake off the main thread. This compatibility helper owns
 * a short-lived session and still terminates its Worker after the job settles.
 */
export function runStudioBg3dPhysicsTimeline(
  inputValue: StudioBg3dPhysicsTimelineInput | unknown,
  options: StudioBg3dPhysicsTimelineWorkerOptions = {},
): Promise<StudioBg3dPhysicsTimelineResult> {
  const session = createStudioBg3dPhysicsTimelineWorkerSession({
    workerFactory: options.workerFactory,
  });
  return session.run(inputValue, {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  }).finally(() => session.dispose());
}
