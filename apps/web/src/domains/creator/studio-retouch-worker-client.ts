import { createStudioAbortableSerialQueue } from "./studio-abortable-serial-queue";
import {
  assertStudioRetouchWorkerRequest,
  STUDIO_RETOUCH_DIRECT_MAX_IMAGE_PIXELS,
  STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION,
  studioRetouchRequestTransfers,
  type StudioRetouchWorkerResponseMessage,
  type StudioRetouchWorkerRunMessage,
  type StudioRetouchWorkerRunRequest,
} from "./studio-retouch-worker-protocol";
import { applyStudioRetouchWorkerRequest } from "./studio-retouch-worker-runtime";

export interface StudioRetouchWorkerLike {
  onmessage: ((event: MessageEvent<StudioRetouchWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  /** Structured-clone receive errors are separate from Worker execution errors. */
  onmessageerror?: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioRetouchWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioRetouchWorkerFactory = () => StudioRetouchWorkerLike | null;
export type StudioRetouchExecutionMode = "worker" | "direct";

export interface StudioRetouchWorkerClientOptions {
  readonly signal?: AbortSignal;
  /** Execution authority is selected before the operation starts and never changes afterward. */
  readonly executionMode?: StudioRetouchExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  readonly workerFactory?: StudioRetouchWorkerFactory | null;
  readonly readyTimeoutMilliseconds?: number;
  readonly operationTimeoutMilliseconds?: number;
}

export interface StudioRetouchWorkerClientResult {
  readonly execution: "worker" | "direct";
  readonly kind: StudioRetouchWorkerRunRequest["kind"];
  readonly data: Uint8ClampedArray;
}

const DEFAULT_READY_TIMEOUT_MS = 3_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/** Vite statically emits one shared code chunk; the default client keeps one serial module Worker. */
export function createStudioRetouchModuleWorker(): StudioRetouchWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-retouch.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-retouch",
  }) as unknown as StudioRetouchWorkerLike;
}

function createAbortError(message = "리터치 계산을 취소했습니다."): Error {
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTimeoutError(): Error {
  const error = new Error("리터치 Worker가 제한 시간 안에 완료되지 않았습니다.");
  error.name = "TimeoutError";
  return error;
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "StudioRetouchWorkerUnavailableError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(120_000, Math.round(value!)));
}

function cloneSafeRequest(
  request: StudioRetouchWorkerRunRequest,
): StudioRetouchWorkerRunRequest {
  assertStudioRetouchWorkerRequest(request);
  const { data } = request;
  const transferable = data.buffer instanceof ArrayBuffer
    && data.byteOffset === 0
    && data.byteLength === data.buffer.byteLength
    ? data
    : new Uint8ClampedArray(data);
  // Own the small mutable journal/settings before any asynchronous queue or ready wait.
  // Do not spread caller objects: incidental UI functions are not structured-cloneable, and
  // changing a shared paintColor must not recolor an earlier, already admitted stroke.
  // Pixel buffers keep the existing dedicated-transfer/subarray-copy ownership contract.
  const raster = {
    data: transferable,
    w: request.w,
    h: request.h,
    points: request.points.map(({ x, y }) => ({ x, y })),
  };
  if (request.kind === "dodge-burn") {
    const { radiusPx, hardness, exposure, mode, range, sponge } = request.settings;
    return {
      ...raster,
      kind: request.kind,
      settings: { radiusPx, hardness, exposure, mode, range, sponge },
    };
  }
  const {
    radiusPx, hardness, strength, wetness, pickup, paintColor,
    loadDepletion, initialLoad, mixModel,
  } = request.settings;
  return {
    ...raster,
    kind: request.kind,
    settings: {
      radiusPx, hardness, strength, wetness, pickup,
      paintColor: { r: paintColor.r, g: paintColor.g, b: paintColor.b },
      ...(loadDepletion === undefined ? {} : { loadDepletion }),
      ...(initialLoad === undefined ? {} : { initialLoad }),
      ...(mixModel === undefined ? {} : { mixModel }),
    },
  };
}

function runRetouchDirect(
  request: StudioRetouchWorkerRunRequest,
  signal: AbortSignal | undefined,
): StudioRetouchWorkerClientResult {
  throwIfAborted(signal);
  if (request.w * request.h > STUDIO_RETOUCH_DIRECT_MAX_IMAGE_PIXELS) {
    throw new RangeError(
      "리터치 Worker를 사용할 수 없어 직접 계산 안전 상한을 초과한 이미지를 중단했습니다.",
    );
  }
  const { data } = applyStudioRetouchWorkerRequest(request);
  throwIfAborted(signal);
  return { execution: "direct", kind: request.kind, data };
}

function deserializeWorkerError(
  response: Extract<StudioRetouchWorkerResponseMessage, { type: "studio-retouch/failure" }>,
): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runRetouchWithWorker(
  worker: StudioRetouchWorkerLike,
  request: StudioRetouchWorkerRunRequest,
  options: StudioRetouchWorkerClientOptions,
  lifecycle: {
    readonly keepAlive?: boolean;
    readonly workerAlreadyReady?: boolean;
    readonly disposeSignal?: AbortSignal;
  } = {},
): Promise<StudioRetouchWorkerClientResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let operationTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioRetouchWorkerRunMessage = {
      type: "studio-retouch/run",
      version: STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION,
      request,
    };

    const cleanup = (keepWorker = false) => {
      if (readyTimer !== null) clearTimeout(readyTimer);
      if (operationTimer !== null) clearTimeout(operationTimer);
      signal?.removeEventListener("abort", onAbort);
      lifecycle.disposeSignal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      if (!keepWorker) worker.terminate();
    };
    const finish = (callback: () => void, keepWorker = false) => {
      if (settled) return;
      settled = true;
      cleanup(keepWorker);
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));
    const rejectWorkerUnavailable = (message: string, cause?: unknown) => finish(() => reject(
      createWorkerUnavailableError(message, cause),
    ));
    const onOperationTimeout = () => finish(() => reject(createTimeoutError()));

    const postRequest = () => {
      if (requestPosted || settled) return;
      if (readyTimer !== null) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      try {
        requestPosted = true;
        worker.postMessage(message, studioRetouchRequestTransfers(message));
        if (!settled) {
          operationTimer = setTimeout(
            onOperationTimeout,
            boundedTimeout(options.operationTimeoutMilliseconds, DEFAULT_OPERATION_TIMEOUT_MS),
          );
        }
      } catch (error) {
        // Once postMessage starts, a custom transport may have detached the buffer before throwing.
        // Fail closed instead of inspecting it in a synchronous fallback.
        const transferError = error instanceof Error
          ? error
          : new Error("리터치 Worker로 픽셀 소유권을 전송하지 못했습니다.");
        finish(() => reject(transferError));
      }
    };

    worker.onmessage = (event) => {
      if (settled) return;
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION
      ) {
        finish(() => reject(new Error("리터치 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-retouch/ready") {
        postRequest();
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("리터치 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-retouch/failure") {
        if (
          !response.error
          || typeof response.error !== "object"
          || typeof response.error.name !== "string"
          || typeof response.error.message !== "string"
        ) {
          finish(() => reject(new Error("리터치 Worker가 알 수 없는 응답을 반환했습니다.")));
          return;
        }
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      if (
        response.type !== "studio-retouch/success"
        || response.kind !== request.kind
        || response.w !== request.w
        || response.h !== request.h
        || !(response.data instanceof Uint8ClampedArray)
        || response.data.byteLength !== request.w * request.h * 4
      ) {
        finish(() => reject(new Error("리터치 Worker 결과가 요청과 일치하지 않습니다.")));
        return;
      }
      finish(
        () => resolve({ execution: "worker", kind: response.kind, data: response.data }),
        lifecycle.keepAlive === true,
      );
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (!requestPosted) {
        rejectWorkerUnavailable(
          "리터치 Worker가 준비되기 전에 사용할 수 없게 되었습니다.",
          event.error ?? event.message,
        );
        return;
      }
      const error = event.error instanceof Error
        ? event.error
        : new Error(event.message || "리터치 Worker 실행 중 오류가 발생했습니다.");
      finish(() => reject(error));
    };

    worker.onmessageerror = () => rejectWorkerUnavailable("리터치 Worker 응답을 읽지 못했습니다.");

    signal?.addEventListener("abort", onAbort, { once: true });
    lifecycle.disposeSignal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted || lifecycle.disposeSignal?.aborted) {
      onAbort();
      return;
    }
    if (lifecycle.workerAlreadyReady) {
      postRequest();
    } else {
      readyTimer = setTimeout(
        () => rejectWorkerUnavailable("리터치 Worker 준비 시간이 초과되었습니다."),
        boundedTimeout(options.readyTimeoutMilliseconds, DEFAULT_READY_TIMEOUT_MS),
      );
    }
  });
}

let sharedRetouchWorker: StudioRetouchWorkerLike | null = null;
let sharedRetouchWorkerReady = false;
let sharedRetouchWorkerEpoch = 0;
let sharedRetouchDisposeGeneration = 0;
const sharedRetouchQueue = createStudioAbortableSerialQueue<
  StudioRetouchWorkerRunRequest,
  StudioRetouchWorkerClientResult
>();
let sharedRetouchIdleTimer: ReturnType<typeof setTimeout> | null = null;
let sharedRetouchFlight: {
  readonly worker: StudioRetouchWorkerLike;
  readonly epoch: number;
  readonly controller: AbortController;
} | null = null;

function clearSharedRetouchIdleTimer(): void {
  if (sharedRetouchIdleTimer === null) return;
  clearTimeout(sharedRetouchIdleTimer);
  sharedRetouchIdleTimer = null;
}

/** Releases the warm module Worker, primarily for route/HMR teardown and deterministic tests. */
export function disposeStudioRetouchModuleWorker(): void {
  clearSharedRetouchIdleTimer();
  const worker = sharedRetouchWorker;
  const flight = sharedRetouchFlight;
  const flightOwnsWorker = worker !== null
    && flight?.worker === worker
    && flight.epoch === sharedRetouchWorkerEpoch;
  sharedRetouchWorker = null;
  sharedRetouchWorkerReady = false;
  sharedRetouchWorkerEpoch += 1;
  sharedRetouchDisposeGeneration += 1;
  sharedRetouchFlight = null;
  sharedRetouchQueue.cancelPending();
  flight?.controller.abort();
  if (worker && !flightOwnsWorker) worker.terminate();
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeStudioRetouchModuleWorker);
}

function clearSharedRetouchWorker(
  worker: StudioRetouchWorkerLike,
  epoch: number,
): void {
  if (sharedRetouchWorker !== worker || sharedRetouchWorkerEpoch !== epoch) return;
  sharedRetouchWorker = null;
  sharedRetouchWorkerReady = false;
  sharedRetouchWorkerEpoch += 1;
}

function scheduleSharedRetouchIdleDisposal(
  worker: StudioRetouchWorkerLike,
  epoch: number,
  disposeGeneration: number,
): void {
  clearSharedRetouchIdleTimer();
  sharedRetouchIdleTimer = setTimeout(() => {
    sharedRetouchIdleTimer = null;
    if (
      sharedRetouchWorker === worker
      && sharedRetouchWorkerEpoch === epoch
      && sharedRetouchDisposeGeneration === disposeGeneration
      && sharedRetouchFlight === null
    ) {
      disposeStudioRetouchModuleWorker();
    }
  }, DEFAULT_IDLE_TIMEOUT_MS);
}

function runRetouchWithSharedModuleWorker(
  request: StudioRetouchWorkerRunRequest,
  options: StudioRetouchWorkerClientOptions,
): Promise<StudioRetouchWorkerClientResult> {
  const disposeGeneration = sharedRetouchDisposeGeneration;
  return sharedRetouchQueue.run(request, async (queuedRequest) => {
    if (disposeGeneration !== sharedRetouchDisposeGeneration) throw createAbortError();
    throwIfAborted(options.signal);
    // Admission can be cancelled before this executor starts. Keep the warm Worker's idle
    // deadline until live work actually takes ownership, including the queue handoff microtask.
    clearSharedRetouchIdleTimer();
    let creationError: unknown;
    if (!sharedRetouchWorker) {
      try {
        sharedRetouchWorker = createStudioRetouchModuleWorker();
      } catch (error) {
        creationError = error;
        sharedRetouchWorker = null;
      }
      sharedRetouchWorkerReady = false;
      if (sharedRetouchWorker) sharedRetouchWorkerEpoch += 1;
    }
    const worker = sharedRetouchWorker;
    if (!worker) {
      throw createWorkerUnavailableError("리터치 Worker를 만들 수 없습니다.", creationError);
    }
    const epoch = sharedRetouchWorkerEpoch;
    const controller = new AbortController();
    sharedRetouchFlight = { worker, epoch, controller };
    try {
      const result = await runRetouchWithWorker(worker, queuedRequest, options, {
        keepAlive: true,
        workerAlreadyReady: sharedRetouchWorkerReady,
        disposeSignal: controller.signal,
      });
      if (result.execution === "worker") {
        if (sharedRetouchWorker === worker && sharedRetouchWorkerEpoch === epoch) {
          sharedRetouchWorkerReady = true;
          scheduleSharedRetouchIdleDisposal(worker, epoch, disposeGeneration);
        }
      } else {
        clearSharedRetouchWorker(worker, epoch);
      }
      return result;
    } catch (error) {
      // Every failure path in runRetouchWithWorker terminates a non-retained Worker.
      clearSharedRetouchWorker(worker, epoch);
      throw error;
    } finally {
      if (sharedRetouchFlight?.controller === controller) sharedRetouchFlight = null;
    }
  }, options.signal);
}

/**
 * Runs one serialized destructive retouch operation. The default module Worker stays warm across
 * strokes; explicit test/custom factories retain the isolated one-shot lifecycle. Pixel ownership
 * is transferred only after readiness, and failures after that boundary reject rather than reading
 * a possibly detached buffer.
 */
export async function runStudioRetouchWorker(
  request: StudioRetouchWorkerRunRequest,
  options: StudioRetouchWorkerClientOptions = {},
): Promise<StudioRetouchWorkerClientResult> {
  throwIfAborted(options.signal);
  const cloneSafe = cloneSafeRequest(request);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") return runRetouchDirect(cloneSafe, options.signal);
  if (options.workerFactory === undefined) {
    return runRetouchWithSharedModuleWorker(cloneSafe, options);
  }
  const factory = options.workerFactory;
  if (!factory) throw createWorkerUnavailableError("리터치 Worker를 만들 수 없습니다.");

  let worker: StudioRetouchWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("리터치 Worker를 만들 수 없습니다.", error);
  }
  if (!worker) throw createWorkerUnavailableError("리터치 Worker를 만들 수 없습니다.");
  return runRetouchWithWorker(worker, cloneSafe, options);
}
