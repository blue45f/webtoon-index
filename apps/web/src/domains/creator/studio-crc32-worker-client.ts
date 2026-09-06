import {
  STUDIO_CRC32_INITIAL_STATE,
  calculateStudioCrc32,
  finalizeStudioCrc32,
  updateStudioCrc32,
} from "./studio-crc32";
import {
  STUDIO_CRC32_WORKER_MAX_BYTES,
  STUDIO_CRC32_WORKER_PROTOCOL_VERSION,
  studioCrc32RunTransfers,
  type StudioCrc32WorkerResponseMessage,
  type StudioCrc32WorkerRunMessage,
} from "./studio-crc32-worker-protocol";

/**
 * Largest slice the bounded direct mode folds in one synchronous task.
 *
 * Inputs up to this size are hashed in a single call (a short metadata-sized task). Larger inputs
 * — the bounded WILL v1 profile allows a 32 MiB strokes part — are folded slice by slice with an
 * event-loop yield between slices, so the main thread is never blocked longer than one slice and
 * a caller that legitimately reaches the profile limit no longer fails after the profile check
 * already accepted its document.
 */
export const STUDIO_CRC32_DIRECT_MAX_BYTES = 1024 * 1024;

const STUDIO_CRC32_WORKER_READY_TIMEOUT_MS = 3_000;
const STUDIO_CRC32_WORKER_RUN_TIMEOUT_MS = 30_000;

export interface StudioCrc32WorkerLike {
  onmessage: ((event: MessageEvent<StudioCrc32WorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioCrc32WorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioCrc32WorkerFactory = () => StudioCrc32WorkerLike | null;
export type StudioCrc32ExecutionMode = "worker" | "direct-bounded" | "direct-headless";

export interface StudioCrc32WorkerRunOptions {
  signal?: AbortSignal;
}

export interface StudioCrc32WorkerResult {
  execution: "worker" | "direct";
  crc32: number;
  /** The caller-owned bytes, returned after Worker ownership transfer. */
  data: Uint8Array;
}

export interface StudioCrc32WorkerSession {
  run(
    data: Uint8Array,
    options?: StudioCrc32WorkerRunOptions,
  ): Promise<StudioCrc32WorkerResult>;
  dispose(): void;
}

export interface StudioCrc32WorkerSessionOptions {
  /** Fixed for the session before any CRC request starts. */
  executionMode: StudioCrc32ExecutionMode;
  /** Test/platform seam for the selected Worker mode. */
  workerFactory?: StudioCrc32WorkerFactory | null;
}

interface ActiveTask {
  readonly requestId: number;
  readonly data: Uint8Array;
  readonly byteLength: number;
  readonly signal?: AbortSignal;
  readonly resolve: (result: StudioCrc32WorkerResult) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
  posted: boolean;
  settled: boolean;
}

/** Vite emits this literal URL as a lazily loaded module-worker chunk. */
export function createStudioCrc32ModuleWorker(): StudioCrc32WorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-crc32.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-crc32",
  }) as unknown as StudioCrc32WorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("CRC32 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("CRC32 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function assertCrc32Input(data: Uint8Array): void {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError("CRC32 Worker 입력은 Uint8Array여야 합니다.");
  }
  if (data.byteLength > STUDIO_CRC32_WORKER_MAX_BYTES) {
    throw new RangeError(
      `CRC32 Worker는 최대 ${STUDIO_CRC32_WORKER_MAX_BYTES.toLocaleString("en-US")}바이트까지 처리합니다.`,
    );
  }
}

function cloneSafeData(data: Uint8Array): Uint8Array {
  const hasDedicatedTransferableBuffer =
    data.buffer instanceof ArrayBuffer
    && data.byteOffset === 0
    && data.byteLength === data.buffer.byteLength;
  return hasDedicatedTransferableBuffer ? data : new Uint8Array(data);
}

function directUnavailableError(byteLength: number): Error {
  return new Error(
    `${byteLength.toLocaleString("en-US")}바이트 CRC32 입력은 선택한 direct 실행 모드의 `
      + "메인 스레드 안전 상한을 초과했습니다.",
  );
}

function workerUnavailableError(message = "CRC32 계산 Worker를 사용할 수 없습니다."): Error {
  const error = new Error(message);
  error.name = "StudioCrc32WorkerError";
  return error;
}

function runDirect(
  data: Uint8Array,
  signal: AbortSignal | undefined,
  directMaxBytes = STUDIO_CRC32_DIRECT_MAX_BYTES,
): StudioCrc32WorkerResult {
  throwIfAborted(signal);
  if (data.byteLength > directMaxBytes) {
    throw directUnavailableError(data.byteLength);
  }
  const crc32 = calculateStudioCrc32(data);
  throwIfAborted(signal);
  return { execution: "direct", crc32, data };
}

/**
 * Hands control back to the event loop between CRC slices. Prefers the scheduler API (which lets
 * pending input run first), then a macrotask so rendering and pointer handlers interleave.
 */
function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler && typeof scheduler.yield === "function") {
    return scheduler.yield().catch(() => undefined);
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Bounded-slice direct CRC for inputs larger than one synchronous task. The digest is identical
 * to `calculateStudioCrc32(data)`; only the scheduling differs. Abort is honoured between slices.
 */
async function runDirectSliced(
  data: Uint8Array,
  signal: AbortSignal | undefined,
  sliceBytes: number,
): Promise<StudioCrc32WorkerResult> {
  let state = STUDIO_CRC32_INITIAL_STATE;
  for (let offset = 0; offset < data.byteLength; offset += sliceBytes) {
    throwIfAborted(signal);
    const end = Math.min(offset + sliceBytes, data.byteLength);
    state = updateStudioCrc32(state, data, offset, end);
    if (end < data.byteLength) await yieldToEventLoop();
  }
  throwIfAborted(signal);
  return { execution: "direct", crc32: finalizeStudioCrc32(state), data };
}

function deserializeWorkerError(
  response: Extract<StudioCrc32WorkerResponseMessage, { type: "studio-crc32/failure" }>,
): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function validWorkerResult(
  response: Extract<StudioCrc32WorkerResponseMessage, { type: "studio-crc32/success" }>,
  expectedBytes: number,
): boolean {
  return (
    response.data instanceof Uint8Array
    && response.data.byteLength === expectedBytes
    && Number.isSafeInteger(response.crc32)
    && response.crc32 >= 0
    && response.crc32 <= 0xffff_ffff
  );
}

/**
 * Latest-request-wins persistent CRC session.
 *
 * Successful sequential archive entries reuse one warm Worker. Abort or supersede terminates the
 * active epoch because ownership may already have transferred; request ids additionally reject
 * any stale queued response.
 */
export function createStudioCrc32WorkerSession(
  options: StudioCrc32WorkerSessionOptions,
): StudioCrc32WorkerSession {
  if (
    options.executionMode !== "worker"
    && options.executionMode !== "direct-bounded"
    && options.executionMode !== "direct-headless"
  ) {
    throw new TypeError("CRC32 실행 모드가 올바르지 않습니다.");
  }
  if (options.executionMode !== "worker") {
    const directMaxBytes = options.executionMode === "direct-headless"
      ? STUDIO_CRC32_WORKER_MAX_BYTES
      : STUDIO_CRC32_DIRECT_MAX_BYTES;
    let disposed = false;
    return {
      run(data, runOptions = {}) {
        if (disposed) return Promise.reject(createAbortError());
        try {
          throwIfAborted(runOptions.signal);
          assertCrc32Input(data);
          if (
            options.executionMode === "direct-headless"
            && typeof globalThis.document !== "undefined"
          ) {
            throw new Error("direct-headless CRC32는 DOM이 없는 실행 환경에서만 사용할 수 있습니다.");
          }
          if (
            options.executionMode === "direct-bounded"
            && data.byteLength > directMaxBytes
          ) {
            // Still "bounded": each synchronous slice stays within the metadata-sized budget;
            // the whole-input ceiling remains the Worker maximum enforced by assertCrc32Input.
            return runDirectSliced(data, runOptions.signal, directMaxBytes);
          }
          return Promise.resolve(runDirect(data, runOptions.signal, directMaxBytes));
        } catch (error) {
          return Promise.reject(error);
        }
      },
      dispose() {
        disposed = true;
      },
    };
  }
  const factory = options.workerFactory === undefined
    ? createStudioCrc32ModuleWorker
    : options.workerFactory;
  let worker: StudioCrc32WorkerLike | null = null;
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
  const postActive = () => {
    const task = active;
    if (!task || !worker || !ready || task.posted || task.settled) return;
    if (task.signal?.aborted) {
      rejectAndReset(task, createAbortError());
      return;
    }
    const message: StudioCrc32WorkerRunMessage = {
      type: "studio-crc32/run",
      version: STUDIO_CRC32_WORKER_PROTOCOL_VERSION,
      requestId: task.requestId,
      data: cloneSafeData(task.data),
    };
    try {
      worker.postMessage(message, studioCrc32RunTransfers(message));
      task.posted = true;
      runTimer = setTimeout(() => {
        if (active !== task) return;
        rejectAndReset(task, new Error("CRC32 Worker 계산 시간이 초과되었습니다."));
      }, STUDIO_CRC32_WORKER_RUN_TIMEOUT_MS);
    } catch (error) {
      rejectAndReset(task, error);
    }
  };
  const attachWorker = (nextWorker: StudioCrc32WorkerLike) => {
    worker = nextWorker;
    ready = false;
    worker.onmessage = (event) => {
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_CRC32_WORKER_PROTOCOL_VERSION
      ) {
        const task = active;
        if (task) rejectAndReset(task, new Error("CRC32 Worker가 알 수 없는 응답을 반환했습니다."));
        else closeWorker();
        return;
      }
      if (response.type === "studio-crc32/ready") {
        if (ready) return;
        clearReadyTimer();
        ready = true;
        postActive();
        return;
      }
      const task = active;
      if (!task || response.requestId !== task.requestId) return;
      if (!task.posted) {
        rejectAndReset(task, new Error("CRC32 Worker가 준비 전에 결과를 반환했습니다."));
        return;
      }
      if (response.type === "studio-crc32/failure") {
        rejectAndReset(task, deserializeWorkerError(response));
        return;
      }
      if (!validWorkerResult(response, task.byteLength)) {
        rejectAndReset(task, new Error("CRC32 Worker 결과 버퍼가 요청과 일치하지 않습니다."));
        return;
      }
      settle(task, () => task.resolve({
        execution: "worker",
        crc32: response.crc32,
        data: response.data,
      }));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const task = active;
      const error = event.error instanceof Error
        ? event.error
        : new Error(event.message || "CRC32 Worker 실행 중 오류가 발생했습니다.");
      if (!task) {
        closeWorker();
        return;
      }
      rejectAndReset(task, error);
    };
    readyTimer = setTimeout(() => {
      const task = active;
      if (!task || ready) return;
      rejectAndReset(task, workerUnavailableError("CRC32 Worker 준비 시간이 초과되었습니다."));
    }, STUDIO_CRC32_WORKER_READY_TIMEOUT_MS);
  };
  const ensureWorker = () => {
    const task = active;
    if (!task || disposed) return;
    if (!factory) {
      rejectAndReset(task, workerUnavailableError());
      return;
    }
    if (worker) {
      if (ready) postActive();
      return;
    }
    try {
      const nextWorker = factory();
      if (!nextWorker) {
        rejectAndReset(task, workerUnavailableError());
        return;
      }
      attachWorker(nextWorker);
    } catch {
      rejectAndReset(task, workerUnavailableError("CRC32 Worker를 생성하지 못했습니다."));
    }
  };

  return {
    run(data, runOptions = {}) {
      if (disposed) return Promise.reject(createAbortError());
      try {
        throwIfAborted(runOptions.signal);
        assertCrc32Input(data);
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
          data,
          byteLength: data.byteLength,
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
