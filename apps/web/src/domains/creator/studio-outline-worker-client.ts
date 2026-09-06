import {
  STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION,
  assertStudioOutlineEpoch,
  assertStudioOutlineImageData,
  studioOutlineRequestTransfers,
  type StudioOutlineWorkerRequestMessage,
  type StudioOutlineWorkerResponseMessage,
  type StudioOutlineWorkerRunMessage,
  type StudioOutlineWorkerRunRequest,
} from "./studio-outline-worker-protocol";

import type { StudioImageDataLike } from "./studio-filters";

const STUDIO_OUTLINE_WORKER_READY_TIMEOUT_MS = 3_000;
export const STUDIO_OUTLINE_WORKER_RUN_TIMEOUT_MS = 15_000;

export interface StudioOutlineWorkerLike {
  onmessage: ((event: MessageEvent<StudioOutlineWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioOutlineWorkerRequestMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioOutlineWorkerFactory = () => StudioOutlineWorkerLike | null;

export interface StudioOutlineWorkerSessionOptions {
  /**
   * `null` explicitly disables Worker construction. Unlike older image-filter
   * clients this path never performs a large synchronous fallback.
   */
  workerFactory?: StudioOutlineWorkerFactory | null;
}

export interface StudioOutlineWorkerRunOptions {
  readonly epoch: number;
  readonly signal?: AbortSignal;
}

export interface StudioOutlineWorkerResult {
  readonly epoch: number;
  readonly imageData: StudioImageDataLike;
}

export interface StudioOutlineWorkerSession {
  run(
    request: StudioOutlineWorkerRunRequest,
    options: StudioOutlineWorkerRunOptions,
  ): Promise<StudioOutlineWorkerResult>;
  dispose(): void;
}

interface PendingRequest {
  readonly epoch: number;
  readonly expectedHeight: number;
  readonly expectedWidth: number;
  readonly message: StudioOutlineWorkerRunMessage;
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: StudioOutlineWorkerResult) => void;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
  posted: boolean;
  runTimer: ReturnType<typeof setTimeout> | null;
}

/** Vite discovers this exact URL and emits a lazy module-worker chunk. */
export function createStudioOutlineModuleWorker(): StudioOutlineWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-outline.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-outline-edt",
  }) as unknown as StudioOutlineWorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("외곽선 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("외곽선 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function createUnavailableError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException(
      "이 환경에서는 고성능 외곽선 Worker를 사용할 수 없습니다.",
      "NotSupportedError",
    );
  }
  const error = new Error("이 환경에서는 고성능 외곽선 Worker를 사용할 수 없습니다.");
  error.name = "NotSupportedError";
  return error;
}

function createRunTimeoutError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("외곽선 Worker 실행 시간이 초과되었습니다.", "TimeoutError");
  }
  const error = new Error("외곽선 Worker 실행 시간이 초과되었습니다.");
  error.name = "TimeoutError";
  return error;
}

function serializeErrorEvent(event: {
  readonly error?: unknown;
  readonly message?: string;
}): Error {
  if (event.error instanceof Error) return event.error;
  return new Error(event.message || "외곽선 Worker 실행에 실패했습니다.");
}

function deserializeWorkerError(response: {
  readonly error: {
    readonly message: string;
    readonly name: string;
  };
}): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function cloneSafeRequest(
  request: StudioOutlineWorkerRunRequest,
): StudioOutlineWorkerRunRequest {
  assertStudioOutlineImageData(request.imageData);
  const source = request.imageData.data;
  const hasDedicatedTransferableBuffer =
    source.buffer instanceof ArrayBuffer
    && source.byteOffset === 0
    && source.byteLength === source.buffer.byteLength;
  return {
    imageData: {
      data: hasDedicatedTransferableBuffer ? source : new Uint8ClampedArray(source),
      width: request.imageData.width,
      height: request.imageData.height,
    },
    outline: {
      color: request.outline.color,
      width: request.outline.width,
      opacity: request.outline.opacity,
      ...(request.outline.secondColor === undefined
        ? {}
        : { secondColor: request.outline.secondColor }),
      ...(request.outline.secondWidth === undefined
        ? {}
        : { secondWidth: request.outline.secondWidth }),
    },
  };
}

class DefaultStudioOutlineWorkerSession implements StudioOutlineWorkerSession {
  private readonly workerFactory: StudioOutlineWorkerFactory | null;
  private readonly pending = new Map<number, PendingRequest>();
  private worker: StudioOutlineWorkerLike | null = null;
  private activeRequestId: number | null = null;
  private ready = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private nextRequestId = 1;
  private disposed = false;

  constructor(options: StudioOutlineWorkerSessionOptions) {
    this.workerFactory = options.workerFactory === undefined
      ? createStudioOutlineModuleWorker
      : options.workerFactory;
  }

  run(
    request: StudioOutlineWorkerRunRequest,
    options: StudioOutlineWorkerRunOptions,
  ): Promise<StudioOutlineWorkerResult> {
    if (this.disposed) {
      return Promise.reject(new Error("외곽선 Worker 세션이 이미 종료되었습니다."));
    }
    assertStudioOutlineEpoch(options.epoch);
    if (options.signal?.aborted) return Promise.reject(createAbortError());

    let cloneSafe: StudioOutlineWorkerRunRequest;
    try {
      cloneSafe = cloneSafeRequest(request);
    } catch (error) {
      return Promise.reject(error);
    }

    try {
      this.ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }

    const requestId = this.nextRequestId++;
    if (!Number.isSafeInteger(this.nextRequestId)) this.nextRequestId = 1;
    const message: StudioOutlineWorkerRunMessage = {
      type: "studio-outline/run",
      version: STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION,
      requestId,
      epoch: options.epoch,
      request: cloneSafe,
    };

    return new Promise<StudioOutlineWorkerResult>((resolve, reject) => {
      const pending: PendingRequest = {
        epoch: options.epoch,
        expectedHeight: cloneSafe.imageData.height,
        expectedWidth: cloneSafe.imageData.width,
        message,
        posted: false,
        runTimer: null,
        reject,
        resolve,
        signal: options.signal,
      };
      if (options.signal) {
        pending.onAbort = () => {
          if (this.pending.get(requestId) !== pending) return;
          const wasActive = this.activeRequestId === requestId;
          this.pending.delete(requestId);
          this.cleanupPending(pending);
          reject(createAbortError());
          if (wasActive) {
            this.restartAfterActiveCancellation();
          } else {
            this.dispatchNext();
          }
        };
        options.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pending.set(requestId, pending);
      if (this.ready) this.dispatchNext();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failSession(createAbortError(), false);
  }

  private ensureWorker(): StudioOutlineWorkerLike {
    if (this.worker) return this.worker;
    const worker = this.workerFactory?.() ?? null;
    if (!worker) throw createUnavailableError();
    this.worker = worker;
    this.ready = false;
    worker.onmessage = (event) => {
      if (this.worker !== worker) return;
      this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      event.preventDefault?.();
      this.failSession(serializeErrorEvent(event));
    };
    this.readyTimer = setTimeout(() => {
      this.failSession(new Error("외곽선 Worker 준비 시간이 초과되었습니다."));
    }, STUDIO_OUTLINE_WORKER_READY_TIMEOUT_MS);
    return worker;
  }

  private handleMessage(response: StudioOutlineWorkerResponseMessage): void {
    if (
      !response
      || typeof response !== "object"
      || response.version !== STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION
    ) {
      this.failSession(new Error("외곽선 Worker가 알 수 없는 응답을 반환했습니다."));
      return;
    }
    if (response.type === "studio-outline/ready") {
      if (this.ready) return;
      this.ready = true;
      if (this.readyTimer !== null) {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      const worker = this.worker;
      if (!worker) return;
      this.dispatchNext();
      return;
    }
    if (
      response.type !== "studio-outline/success"
      && response.type !== "studio-outline/failure"
    ) {
      this.failSession(new Error("외곽선 Worker 응답 종류가 올바르지 않습니다."));
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (
      !pending
      || !pending.posted
      || this.activeRequestId !== response.requestId
    ) {
      this.failSession(new Error("외곽선 Worker가 실행 중이지 않은 요청의 결과를 반환했습니다."));
      return;
    }
    if (response.epoch !== pending.epoch) {
      this.failSession(new Error("외곽선 Worker 응답 epoch가 요청과 일치하지 않습니다."));
      return;
    }
    this.pending.delete(response.requestId);
    this.cleanupPending(pending);
    this.activeRequestId = null;
    if (response.type === "studio-outline/failure") {
      pending.reject(deserializeWorkerError(response));
      this.dispatchNext();
      return;
    }
    try {
      assertStudioOutlineImageData(response.imageData, "외곽선 Worker 결과");
      if (
        response.imageData.width !== pending.expectedWidth
        || response.imageData.height !== pending.expectedHeight
      ) {
        throw new RangeError("외곽선 Worker 결과 크기가 요청과 일치하지 않습니다.");
      }
      pending.resolve({
        epoch: response.epoch,
        imageData: response.imageData,
      });
      this.dispatchNext();
    } catch (error) {
      pending.reject(error);
      this.failSession(
        error instanceof Error
          ? error
          : new Error("외곽선 Worker 결과 검증에 실패했습니다."),
      );
    }
  }

  private postPending(
    worker: StudioOutlineWorkerLike,
    pending: PendingRequest,
  ): void {
    if (
      pending.posted
      || pending.signal?.aborted
      || this.activeRequestId !== null
    ) {
      return;
    }
    pending.posted = true;
    this.activeRequestId = pending.message.requestId;
    try {
      worker.postMessage(
        pending.message,
        studioOutlineRequestTransfers(pending.message),
      );
      if (
        this.pending.get(pending.message.requestId) === pending
        && this.activeRequestId === pending.message.requestId
      ) {
        pending.runTimer = setTimeout(() => {
          if (
            this.pending.get(pending.message.requestId) !== pending
            || this.activeRequestId !== pending.message.requestId
          ) {
            return;
          }
          this.pending.delete(pending.message.requestId);
          this.cleanupPending(pending);
          pending.reject(createRunTimeoutError());
          this.restartAfterActiveCancellation();
        }, STUDIO_OUTLINE_WORKER_RUN_TIMEOUT_MS);
      }
    } catch (error) {
      this.failSession(
        error instanceof Error
          ? error
          : new Error("외곽선 Worker 요청 전송에 실패했습니다."),
      );
    }
  }

  private cleanupPending(pending: PendingRequest): void {
    if (pending.runTimer !== null) {
      clearTimeout(pending.runTimer);
      pending.runTimer = null;
    }
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener("abort", pending.onAbort);
    }
  }

  private dispatchNext(): void {
    if (
      !this.ready
      || this.activeRequestId !== null
      || !this.worker
    ) {
      return;
    }
    for (const pending of this.pending.values()) {
      if (pending.signal?.aborted) continue;
      this.postPending(this.worker, pending);
      return;
    }
  }

  /**
   * EDT is synchronous inside its Worker. Termination is therefore the only reliable way to
   * stop a superseded/aborted calculation. Only one request is ever transferred at a time, so
   * restarting cannot discard another node's in-flight buffer; queued owners keep their private
   * snapshots and resume on the replacement Worker.
   */
  private restartAfterActiveCancellation(): void {
    this.activeRequestId = null;
    this.stopWorker();
    if (this.disposed || this.pending.size === 0) return;
    try {
      this.ensureWorker();
    } catch (error) {
      this.failSession(
        error instanceof Error
          ? error
          : new Error("외곽선 Worker 재시작에 실패했습니다."),
      );
    }
  }

  private stopWorker(): void {
    if (this.readyTimer !== null) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }

  private failSession(error: Error, allowReuse = true): void {
    this.activeRequestId = null;
    this.stopWorker();
    for (const pending of this.pending.values()) {
      this.cleanupPending(pending);
      pending.reject(error);
    }
    this.pending.clear();
    if (!allowReuse) this.disposed = true;
  }
}

export function createStudioOutlineWorkerSession(
  options: StudioOutlineWorkerSessionOptions = {},
): StudioOutlineWorkerSession {
  return new DefaultStudioOutlineWorkerSession(options);
}

let sharedOutlineWorkerSession: StudioOutlineWorkerSession | null = null;

/**
 * Shared persistent Worker used by Konva outline filters across image nodes.
 * Each call carries an owner epoch; aborting one node only drops its pending result.
 */
export function runStudioOutlineWorker(
  request: StudioOutlineWorkerRunRequest,
  options: StudioOutlineWorkerRunOptions,
): Promise<StudioOutlineWorkerResult> {
  sharedOutlineWorkerSession ??= createStudioOutlineWorkerSession();
  return sharedOutlineWorkerSession.run(request, options);
}

export function disposeSharedStudioOutlineWorker(): void {
  sharedOutlineWorkerSession?.dispose();
  sharedOutlineWorkerSession = null;
}
