import {
  STUDIO_COLOR_RANGE_WORKER_MAX_PIXELS,
  STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION,
  isStudioColorRangeWorkerSelection,
  studioColorRangeRequestTransfers,
  type StudioColorRangeWorkerResponseMessage,
  type StudioColorRangeWorkerRunMessage,
  type StudioColorRangeWorkerRunRequest,
} from "./studio-color-range-worker-protocol";
import { executeStudioColorRangeWorkerRequest } from "./studio-color-range-worker-runtime";

import type { PixelSelection } from "./studio-selection-tools";

/**
 * Explicit synchronous mode stays below a quarter-size trace raster. On larger rasters, blocking
 * the editor would reintroduce the exact long task this boundary removes.
 */
export const STUDIO_COLOR_RANGE_DIRECT_MAX_PIXELS = 256 * 256;

const STUDIO_COLOR_RANGE_WORKER_READY_TIMEOUT_MS = 3_000;
const STUDIO_COLOR_RANGE_WORKER_RUN_TIMEOUT_MS = 30_000;

export interface StudioColorRangeWorkerLike {
  onmessage: ((event: MessageEvent<StudioColorRangeWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioColorRangeWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioColorRangeWorkerFactory = () => StudioColorRangeWorkerLike | null;
export type StudioColorRangeExecutionMode = "worker" | "direct";

export interface StudioColorRangeWorkerRunOptions {
  signal?: AbortSignal;
}

export interface StudioColorRangeWorkerClientResult {
  execution: "worker" | "direct";
  selection: PixelSelection | null;
}

export interface StudioColorRangeWorkerSession {
  run(
    request: StudioColorRangeWorkerRunRequest,
    options?: StudioColorRangeWorkerRunOptions,
  ): Promise<StudioColorRangeWorkerClientResult>;
  dispose(): void;
}

export interface StudioColorRangeWorkerSessionOptions {
  /** Execution authority is selected when the session is created and never changes afterward. */
  executionMode?: StudioColorRangeExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  workerFactory?: StudioColorRangeWorkerFactory | null;
}

interface ActiveTask {
  readonly requestId: number;
  readonly request: StudioColorRangeWorkerRunRequest;
  readonly signal?: AbortSignal;
  readonly resolve: (result: StudioColorRangeWorkerClientResult) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
  posted: boolean;
  settled: boolean;
}

/** Vite discovers this literal URL and emits one lazily loaded module-worker chunk. */
export function createStudioColorRangeModuleWorker(): StudioColorRangeWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-color-range.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-color-range",
  }) as unknown as StudioColorRangeWorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("색상 범위 선택 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("색상 범위 선택 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function pixelCountOf(request: StudioColorRangeWorkerRunRequest): number {
  return request.width * request.height;
}

function assertStudioColorRangeWorkerRequest(
  request: StudioColorRangeWorkerRunRequest,
): void {
  if (!request || typeof request !== "object") {
    throw new TypeError("색상 범위 Worker 요청이 올바르지 않습니다.");
  }
  if (
    !Number.isSafeInteger(request.width)
    || !Number.isSafeInteger(request.height)
    || request.width < 1
    || request.height < 1
  ) {
    throw new RangeError("색상 범위 Worker 이미지 크기가 올바르지 않습니다.");
  }
  const pixelCount = pixelCountOf(request);
  if (
    !Number.isSafeInteger(pixelCount)
    || pixelCount > STUDIO_COLOR_RANGE_WORKER_MAX_PIXELS
  ) {
    throw new RangeError(
      `색상 범위 Worker는 최대 ${STUDIO_COLOR_RANGE_WORKER_MAX_PIXELS.toLocaleString("en-US")}픽셀까지 처리합니다.`,
    );
  }
  if (
    !(request.data instanceof Uint8ClampedArray)
    || request.data.byteLength !== pixelCount * 4
  ) {
    throw new RangeError("색상 범위 Worker RGBA 버퍼 크기가 이미지와 일치하지 않습니다.");
  }
  if (!Array.isArray(request.samples) || request.samples.length > 8) {
    throw new RangeError("색상 범위 Worker 샘플 수가 올바르지 않습니다.");
  }
  for (const sample of request.samples) {
    if (
      !sample
      || typeof sample !== "object"
      || !Number.isFinite(sample.r)
      || !Number.isFinite(sample.g)
      || !Number.isFinite(sample.b)
    ) {
      throw new TypeError("색상 범위 Worker 색 샘플이 올바르지 않습니다.");
    }
  }
  if (!Number.isFinite(request.fuzziness)) {
    throw new TypeError("색상 범위 Worker 허용량이 올바르지 않습니다.");
  }
  if (
    request.combineMode !== "add"
    && request.combineMode !== "subtract"
    && request.combineMode !== "intersect"
  ) {
    throw new TypeError("색상 범위 Worker 선택 결합 모드가 올바르지 않습니다.");
  }
  if (
    request.aspect !== undefined
    && (!Number.isFinite(request.aspect) || request.aspect <= 0)
  ) {
    throw new RangeError("색상 범위 Worker 선택 종횡비가 올바르지 않습니다.");
  }
  if (request.selection !== null && typeof request.selection !== "object") {
    throw new TypeError("색상 범위 Worker 기존 선택 상태가 올바르지 않습니다.");
  }
}

function cloneSafeWorkerRequest(
  request: StudioColorRangeWorkerRunRequest,
): StudioColorRangeWorkerRunRequest {
  const data = request.data;
  const hasDedicatedTransferableBuffer =
    data.buffer instanceof ArrayBuffer
    && data.byteOffset === 0
    && data.byteLength === data.buffer.byteLength;
  return {
    ...request,
    data: hasDedicatedTransferableBuffer ? data : new Uint8ClampedArray(data),
    samples: request.samples.map((sample) => ({
      r: sample.r,
      g: sample.g,
      b: sample.b,
    })),
  };
}

function directUnavailableError(pixelCount: number, cause?: unknown): Error {
  const detail = cause instanceof Error && cause.message ? ` (${cause.message})` : "";
  return new Error(
    `색상 범위 계산 Worker를 사용할 수 없습니다${detail}. `
      + `${pixelCount.toLocaleString("en-US")}픽셀 이미지는 편집 화면 멈춤을 막기 위해 메인 스레드에서 계산하지 않습니다. `
      + "브라우저의 Worker/CSP 설정을 확인한 뒤 다시 시도해 주세요.",
  );
}

function workerUnavailableError(cause?: unknown): Error {
  const error = new Error(
    "색상 범위 계산 Worker를 사용할 수 없습니다.",
    cause === undefined ? undefined : { cause },
  );
  error.name = "StudioColorRangeWorkerUnavailableError";
  return error;
}

function runDirect(
  request: StudioColorRangeWorkerRunRequest,
  signal: AbortSignal | undefined,
): StudioColorRangeWorkerClientResult {
  throwIfAborted(signal);
  const pixelCount = pixelCountOf(request);
  if (pixelCount > STUDIO_COLOR_RANGE_DIRECT_MAX_PIXELS) {
    throw directUnavailableError(pixelCount);
  }
  const selection = executeStudioColorRangeWorkerRequest(request);
  throwIfAborted(signal);
  return { execution: "direct", selection };
}

function deserializeWorkerError(
  response: Extract<StudioColorRangeWorkerResponseMessage, { type: "studio-color-range/failure" }>,
): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

/**
 * Latest-request-wins persistent session.
 *
 * A completed request keeps its module Worker warm. Superseding or aborting an in-flight request
 * terminates that Worker, which both stops CPU work and makes a detached late response impossible;
 * the next request lazily creates a fresh epoch. Request ids still gate every response so injected
 * or queued stale messages are ignored.
 */
export function createStudioColorRangeWorkerSession(
  options: StudioColorRangeWorkerSessionOptions = {},
): StudioColorRangeWorkerSession {
  const executionMode = options.executionMode ?? "worker";
  const factory = options.workerFactory === undefined
    ? createStudioColorRangeModuleWorker
    : options.workerFactory;
  let worker: StudioColorRangeWorkerLike | null = null;
  let ready = false;
  let disposed = false;
  let active: ActiveTask | null = null;
  let nextRequestId = 0;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let runTimer: ReturnType<typeof setTimeout> | null = null;

  const clearReadyTimer = () => {
    if (readyTimer !== null) clearTimeout(readyTimer);
    readyTimer = null;
  };
  const clearRunTimer = () => {
    if (runTimer !== null) clearTimeout(runTimer);
    runTimer = null;
  };
  const closeWorker = () => {
    clearReadyTimer();
    clearRunTimer();
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    }
    worker = null;
    ready = false;
  };
  const settle = (task: ActiveTask, callback: () => void) => {
    if (task.settled) return;
    task.settled = true;
    task.signal?.removeEventListener("abort", task.onAbort);
    if (active === task) active = null;
    clearRunTimer();
    callback();
  };
  const rejectAndReset = (task: ActiveTask, error: unknown) => {
    closeWorker();
    settle(task, () => task.reject(error));
  };
  const rejectWorkerUnavailable = (task: ActiveTask, cause?: unknown) => {
    closeWorker();
    settle(task, () => task.reject(workerUnavailableError(cause)));
  };
  const postActive = () => {
    const task = active;
    if (!task || !worker || !ready || task.posted || task.settled) return;
    if (task.signal?.aborted) {
      rejectAndReset(task, createAbortError());
      return;
    }
    const message: StudioColorRangeWorkerRunMessage = {
      type: "studio-color-range/run",
      version: STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION,
      requestId: task.requestId,
      request: cloneSafeWorkerRequest(task.request),
    };
    try {
      worker.postMessage(message, studioColorRangeRequestTransfers(message));
      task.posted = true;
      runTimer = setTimeout(() => {
        if (active !== task) return;
        rejectAndReset(task, new Error("색상 범위 Worker 계산 시간이 초과되었습니다."));
      }, STUDIO_COLOR_RANGE_WORKER_RUN_TIMEOUT_MS);
    } catch (error) {
      rejectWorkerUnavailable(task, error);
    }
  };
  const attachWorker = (nextWorker: StudioColorRangeWorkerLike) => {
    worker = nextWorker;
    ready = false;
    worker.onmessage = (event) => {
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION
      ) {
        const task = active;
        if (task) rejectAndReset(task, new Error("색상 범위 Worker가 알 수 없는 응답을 반환했습니다."));
        else closeWorker();
        return;
      }
      if (response.type === "studio-color-range/ready") {
        if (ready) return;
        clearReadyTimer();
        ready = true;
        postActive();
        return;
      }
      const task = active;
      // A terminated/superseded epoch may still have queued an event. It has no authority.
      if (!task || response.requestId !== task.requestId) return;
      if (!task.posted) {
        rejectAndReset(task, new Error("색상 범위 Worker가 준비 전에 결과를 반환했습니다."));
        return;
      }
      if (response.type === "studio-color-range/failure") {
        rejectAndReset(task, deserializeWorkerError(response));
        return;
      }
      if (
        response.type !== "studio-color-range/success"
        || !isStudioColorRangeWorkerSelection(response.selection)
      ) {
        rejectAndReset(
          task,
          new Error("색상 범위 Worker가 올바르지 않은 선택 결과를 반환했습니다."),
        );
        return;
      }
      settle(task, () => task.resolve({
        execution: "worker",
        selection: response.selection,
      }));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const task = active;
      const wasPosted = task?.posted === true;
      const error = event.error instanceof Error
        ? event.error
        : new Error(event.message || "색상 범위 Worker 실행 중 오류가 발생했습니다.");
      if (!task) {
        closeWorker();
        return;
      }
      if (!wasPosted) {
        rejectWorkerUnavailable(task, error);
        return;
      }
      rejectAndReset(task, error);
    };
    readyTimer = setTimeout(() => {
      const task = active;
      if (!task || ready) return;
      rejectWorkerUnavailable(task, new Error("Worker 준비 시간이 초과되었습니다."));
    }, STUDIO_COLOR_RANGE_WORKER_READY_TIMEOUT_MS);
  };
  const ensureWorker = () => {
    const task = active;
    if (!task || disposed) return;
    if (!factory) {
      rejectWorkerUnavailable(task);
      return;
    }
    if (worker) {
      if (ready) postActive();
      return;
    }
    try {
      const nextWorker = factory();
      if (!nextWorker) {
        rejectWorkerUnavailable(task);
        return;
      }
      attachWorker(nextWorker);
    } catch (error) {
      rejectWorkerUnavailable(task, error);
    }
  };

  return {
    run(request, runOptions = {}) {
      if (disposed) return Promise.reject(createAbortError());
      try {
        throwIfAborted(runOptions.signal);
        assertStudioColorRangeWorkerRequest(request);
        if (executionMode === "direct") {
          return Promise.resolve(runDirect(request, runOptions.signal));
        }
      } catch (error) {
        return Promise.reject(error);
      }
      if (active) {
        const superseded = active;
        closeWorker();
        settle(superseded, () => superseded.reject(createAbortError()));
      }
      return new Promise((resolve, reject) => {
        const task: ActiveTask = {
          requestId: ++nextRequestId,
          request,
          signal: runOptions.signal,
          resolve,
          reject,
          posted: false,
          settled: false,
          onAbort: () => {
            if (active !== task) return;
            rejectAndReset(task, createAbortError());
          },
        };
        task.signal?.addEventListener("abort", task.onAbort, { once: true });
        active = task;
        ensureWorker();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const task = active;
      closeWorker();
      if (task) settle(task, () => task.reject(createAbortError()));
    },
  };
}
