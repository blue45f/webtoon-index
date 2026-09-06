import {
  STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
  StudioVrmPhotoPoseError,
  admitStudioVrmPhotoPoseFile,
  normalizeStudioVrmPhotoPoseOptions,
  type StudioVrmPhotoPoseFileLike,
  type StudioVrmPhotoPoseInputOptions,
} from "./studio-vrm-photo-pose";
import {
  isStudioVrmPhotoPoseWorkerResponse,
  studioVrmPhotoPoseRequestTransfers,
  type StudioVrmPhotoPosePreprocessedImage,
  type StudioVrmPhotoPoseWorkerRequest,
  type StudioVrmPhotoPoseWorkerStage,
} from "./studio-vrm-photo-pose-worker-protocol";

export const STUDIO_VRM_PHOTO_POSE_WORKER_TIMEOUT_MS = 20_000;

export type StudioVrmPhotoPoseProgressStage =
  | "admission"
  | "reading"
  | StudioVrmPhotoPoseWorkerStage
  | "ready";

export interface StudioVrmPhotoPoseProgress {
  readonly generationId: number;
  readonly stage: StudioVrmPhotoPoseProgressStage;
  readonly progress: number;
}

export interface StudioVrmPhotoPoseReadableFile extends StudioVrmPhotoPoseFileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioVrmPhotoPoseWorkerLike {
  postMessage(message: StudioVrmPhotoPoseWorkerRequest, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorEventLike) => void): void;
  terminate(): void;
}

export interface StudioVrmPhotoPosePreprocessorOptions {
  readonly workerFactory?: () => StudioVrmPhotoPoseWorkerLike;
  readonly timeoutMs?: number;
}

export interface StudioVrmPhotoPoseStartOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioVrmPhotoPoseProgress) => void;
}

export interface StudioVrmPhotoPosePreprocessJob {
  readonly generationId: number;
  readonly result: Promise<StudioVrmPhotoPosePreprocessedImage>;
  cancel(): void;
}

interface PendingJob {
  readonly generationId: number;
  readonly requestId: number;
  readonly reject: (error: StudioVrmPhotoPoseError) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
  readonly signal?: AbortSignal;
  readonly abortListener?: () => void;
  worker: StudioVrmPhotoPoseWorkerLike | null;
  settled: boolean;
  lastProgress: number;
}

function defaultWorkerFactory(): StudioVrmPhotoPoseWorkerLike {
  return new Worker(new URL("./studio-vrm-photo-pose.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-vrm-photo-pose-preprocessor",
  });
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return STUDIO_VRM_PHOTO_POSE_WORKER_TIMEOUT_MS;
  if (!Number.isFinite(value)) return STUDIO_VRM_PHOTO_POSE_WORKER_TIMEOUT_MS;
  return Math.max(1_000, Math.min(120_000, Math.floor(value)));
}

function closePossibleBitmap(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const result = (value as { result?: unknown }).result;
  if (typeof result !== "object" || result === null) return;
  const bitmap = (result as { bitmap?: unknown }).bitmap;
  if (typeof bitmap !== "object" || bitmap === null) return;
  const close = (bitmap as { close?: unknown }).close;
  if (typeof close !== "function") return;
  try {
    close.call(bitmap);
  } catch {
    // Best-effort cleanup for an invalid/foreign worker payload.
  }
}

/**
 * Owns one photo preprocessing generation at a time. Starting a newer generation rejects and
 * terminates the prior job, so a late photo can never overwrite the user's latest selection.
 * The byte path uses Blob/createImageBitmap in the Worker and deliberately never creates an
 * object URL or sends data to a server.
 */
export class StudioVrmPhotoPosePreprocessor {
  readonly #workerFactory: () => StudioVrmPhotoPoseWorkerLike;
  readonly #timeoutMs: number;
  #generationId = 0;
  #requestId = 0;
  #active: PendingJob | null = null;
  #disposed = false;

  constructor(options: StudioVrmPhotoPosePreprocessorOptions = {}) {
    this.#workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.#timeoutMs = boundedTimeout(options.timeoutMs);
  }

  get currentGenerationId(): number {
    return this.#generationId;
  }

  start(
    file: StudioVrmPhotoPoseReadableFile,
    inputOptions: StudioVrmPhotoPoseInputOptions = {},
    startOptions: StudioVrmPhotoPoseStartOptions = {},
  ): StudioVrmPhotoPosePreprocessJob {
    if (this.#disposed) throw new StudioVrmPhotoPoseError("disposed");
    const generationId = this.#nextGeneration();
    this.#cancelActive("stale-generation");
    const admission = admitStudioVrmPhotoPoseFile(file);
    const options = normalizeStudioVrmPhotoPoseOptions(inputOptions);
    const requestId = this.#nextRequest();
    let cancel: () => void = () => undefined;

    const result = new Promise<StudioVrmPhotoPosePreprocessedImage>((resolve, reject) => {
      const timeout = setTimeout(() => this.#failActive(generationId, "timeout"), this.#timeoutMs);
      const pending: PendingJob = {
        generationId,
        requestId,
        reject,
        timeout,
        signal: startOptions.signal,
        worker: null,
        settled: false,
        lastProgress: 0,
      };
      const abortListener = () => this.#failActive(generationId, "aborted");
      Object.assign(pending, { abortListener });
      this.#active = pending;
      cancel = abortListener;
      startOptions.signal?.addEventListener("abort", abortListener, { once: true });
      if (startOptions.signal?.aborted) {
        abortListener();
        return;
      }
      this.#progress(pending, startOptions.onProgress, "admission", 0.05);

      void Promise.resolve().then(() => file.arrayBuffer()).then((bytes) => {
        if (!this.#isActive(pending)) return;
        this.#progress(pending, startOptions.onProgress, "reading", 0.12);
        if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== admission.byteSize) {
          this.#fail(pending, new StudioVrmPhotoPoseError("protocol"));
          return;
        }
        let worker: StudioVrmPhotoPoseWorkerLike;
        try {
          worker = this.#workerFactory();
          pending.worker = worker;
          worker.addEventListener("message", handleMessage);
          worker.addEventListener("error", handleWorkerFailure);
          worker.addEventListener("messageerror", handleWorkerFailure);
        } catch (error) {
          this.#fail(pending, new StudioVrmPhotoPoseError("worker-failed", { cause: error }));
          return;
        }
        const request: StudioVrmPhotoPoseWorkerRequest = {
          version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
          kind: "preprocess",
          requestId,
          generationId,
          bytes,
          admission,
          options,
        };
        try {
          worker.postMessage(request, studioVrmPhotoPoseRequestTransfers(request));
        } catch (error) {
          this.#fail(pending, new StudioVrmPhotoPoseError("worker-failed", { cause: error }));
        }
      }).catch((error: unknown) => {
        if (this.#isActive(pending)) {
          this.#fail(pending, new StudioVrmPhotoPoseError("decode-failed", { cause: error }));
        }
      });

      const handleMessage = (event: WorkerMessageEventLike): void => {
        if (!this.#isActive(pending)) {
          closePossibleBitmap(event.data);
          return;
        }
        const response = event.data;
        if (
          !isStudioVrmPhotoPoseWorkerResponse(response)
          || response.requestId !== requestId
          || response.generationId !== generationId
        ) {
          closePossibleBitmap(response);
          this.#fail(pending, new StudioVrmPhotoPoseError("protocol"));
          return;
        }
        if (response.kind === "progress") {
          const progress = 0.12 + response.progress * 0.78;
          if (progress < pending.lastProgress) {
            this.#fail(pending, new StudioVrmPhotoPoseError("protocol"));
            return;
          }
          this.#progress(pending, startOptions.onProgress, response.stage, progress);
          return;
        }
        if (response.kind === "error") {
          this.#fail(pending, new StudioVrmPhotoPoseError(response.code));
          return;
        }
        if (
          response.result.source.byteSize !== admission.byteSize
          || response.result.source.mimeType !== admission.mimeType
          || response.result.output.rotation !== options.rotation
          || response.result.output.mirrorHorizontal !== options.mirrorHorizontal
        ) {
          try {
            response.result.bitmap.close();
          } catch {
            // The payload is rejected regardless; cleanup is best effort at this boundary.
          }
          this.#fail(pending, new StudioVrmPhotoPoseError("protocol"));
          return;
        }
        this.#progress(pending, startOptions.onProgress, "ready", 1);
        this.#settle(pending);
        resolve(response.result);
      };

      const handleWorkerFailure = (event: WorkerErrorEventLike): void => {
        event.preventDefault?.();
        if (this.#isActive(pending)) this.#fail(pending, new StudioVrmPhotoPoseError("worker-failed"));
      };
    });

    return { generationId, result, cancel: () => cancel() };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelActive("disposed");
  }

  #nextGeneration(): number {
    this.#generationId = this.#generationId >= Number.MAX_SAFE_INTEGER ? 1 : this.#generationId + 1;
    return this.#generationId;
  }

  #nextRequest(): number {
    this.#requestId = this.#requestId >= Number.MAX_SAFE_INTEGER ? 1 : this.#requestId + 1;
    return this.#requestId;
  }

  #isActive(pending: PendingJob): boolean {
    return this.#active === pending && !pending.settled;
  }

  #progress(
    pending: PendingJob,
    listener: StudioVrmPhotoPoseStartOptions["onProgress"],
    stage: StudioVrmPhotoPoseProgressStage,
    progress: number,
  ): void {
    pending.lastProgress = progress;
    try {
      listener?.({ generationId: pending.generationId, stage, progress });
    } catch {
      // Progress is observational and must not change worker/job ownership.
    }
  }

  #failActive(generationId: number, code: ConstructorParameters<typeof StudioVrmPhotoPoseError>[0]): void {
    const pending = this.#active;
    if (pending?.generationId === generationId) this.#fail(pending, new StudioVrmPhotoPoseError(code));
  }

  #cancelActive(code: ConstructorParameters<typeof StudioVrmPhotoPoseError>[0]): void {
    const pending = this.#active;
    if (pending) this.#fail(pending, new StudioVrmPhotoPoseError(code));
  }

  #fail(pending: PendingJob, error: StudioVrmPhotoPoseError): void {
    if (!this.#isActive(pending)) return;
    const worker = pending.worker;
    if (worker) {
      try {
        worker.postMessage({
          version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
          kind: "cancel",
          requestId: pending.requestId,
          generationId: pending.generationId,
        });
      } catch {
        // The job is already rejected locally and the worker is terminated below.
      }
    }
    this.#settle(pending);
    pending.reject(error);
  }

  #settle(pending: PendingJob): void {
    if (pending.settled) return;
    pending.settled = true;
    clearTimeout(pending.timeout);
    if (pending.abortListener) pending.signal?.removeEventListener("abort", pending.abortListener);
    pending.worker?.terminate();
    pending.worker = null;
    if (this.#active === pending) this.#active = null;
  }
}
