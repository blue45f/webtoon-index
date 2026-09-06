import { createStudioAbortableSerialQueue } from "./studio-abortable-serial-queue";
import { smudgeStroke } from "./studio-smudge";
import {
  STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION,
  studioSmudgeRequestTransfers,
  type StudioSmudgeWorkerResponseMessage,
  type StudioSmudgeWorkerRunMessage,
  type StudioSmudgeWorkerRunRequest,
} from "./studio-smudge-worker-protocol";

export interface StudioSmudgeWorkerLike {
  onmessage: ((event: MessageEvent<StudioSmudgeWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  /** Structured-clone receive errors are separate from Worker execution errors. */
  onmessageerror?: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioSmudgeWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioSmudgeWorkerFactory = () => StudioSmudgeWorkerLike | null;
export type StudioSmudgeExecutionMode = "worker" | "direct";

export interface StudioSmudgeWorkerClientOptions {
  signal?: AbortSignal;
  /** Execution authority is selected before the operation starts and never changes afterward. */
  executionMode?: StudioSmudgeExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  workerFactory?: StudioSmudgeWorkerFactory | null;
  readyTimeoutMilliseconds?: number;
  operationTimeoutMilliseconds?: number;
}

export interface StudioSmudgeWorkerClientResult {
  execution: "worker" | "direct";
  data: Uint8ClampedArray;
}

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioSmudgeModuleWorker(): StudioSmudgeWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-smudge.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-smudge",
  }) as unknown as StudioSmudgeWorkerLike;
}

const DEFAULT_READY_TIMEOUT_MS = 3_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;
const SMUDGE_DIRECT_MAX_IMAGE_PIXELS = 4 * 1024 * 1024;
const SMUDGE_MAX_IMAGE_PIXELS = 64 * 1024 * 1024;
const SMUDGE_MAX_INPUT_POINTS = 8_192;

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("문지르기 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("문지르기 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function createTimeoutError(): Error {
  const error = new Error("문지르기 Worker가 제한 시간 안에 완료되지 않았습니다.");
  error.name = "TimeoutError";
  return error;
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "StudioSmudgeWorkerUnavailableError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(120_000, Math.round(value!)));
}

function cloneSafeRequest(request: StudioSmudgeWorkerRunRequest): StudioSmudgeWorkerRunRequest {
  const { data, w, h, points, radiusPx, strength } = request;
  if (
    !(data instanceof Uint8ClampedArray)
    || !Number.isSafeInteger(w)
    || !Number.isSafeInteger(h)
    || w <= 0
    || h <= 0
    || w * h > SMUDGE_MAX_IMAGE_PIXELS
    || data.byteLength !== w * h * 4
  ) {
    throw new RangeError("문지르기 픽셀 버퍼와 이미지 크기가 올바르지 않습니다.");
  }
  if (!Array.isArray(points) || points.length > SMUDGE_MAX_INPUT_POINTS) {
    throw new RangeError("문지르기 스트로크 점 수가 안전 한도를 초과했습니다.");
  }
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError("문지르기 스트로크 좌표가 올바르지 않습니다.");
    }
  }
  if (!Number.isFinite(radiusPx) || radiusPx <= 0) {
    throw new RangeError("문지르기 반경이 올바르지 않습니다.");
  }
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new RangeError("문지르기 강도가 올바르지 않습니다.");
  }
  const transferable = data.buffer instanceof ArrayBuffer
    && data.byteOffset === 0
    && data.byteLength === data.buffer.byteLength
    ? data
    : new Uint8ClampedArray(data);
  // Admission may wait for readiness or an earlier stroke. Snapshot the journal now, not at
  // postMessage time; caller-owned points can be reused while this request is queued. Project
  // only protocol fields so UI helpers cannot produce DataCloneError at the transfer boundary.
  // Dedicated pixel buffers retain the existing ownership-transfer contract.
  return {
    data: transferable,
    w,
    h,
    points: points.map(({ x, y }) => ({ x, y })),
    radiusPx,
    strength,
  };
}

function runSmudgeDirect(
  request: StudioSmudgeWorkerRunRequest,
  signal: AbortSignal | undefined,
): StudioSmudgeWorkerClientResult {
  throwIfAborted(signal);
  if (request.w * request.h > SMUDGE_DIRECT_MAX_IMAGE_PIXELS) {
    throw new RangeError(
      "문지르기 Worker를 사용할 수 없어 직접 계산 안전 상한을 초과한 이미지를 중단했습니다.",
    );
  }
  const data = smudgeStroke(request.data, request.w, request.h, request.points, request.radiusPx, request.strength);
  throwIfAborted(signal);
  return { execution: "direct", data };
}

function deserializeWorkerError(response: Extract<
  StudioSmudgeWorkerResponseMessage,
  { type: "studio-smudge/failure" }
>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runSmudgeWithWorker(
  worker: StudioSmudgeWorkerLike,
  request: StudioSmudgeWorkerRunRequest,
  options: StudioSmudgeWorkerClientOptions,
  lifecycle: {
    readonly keepAlive?: boolean;
    readonly workerAlreadyReady?: boolean;
    readonly disposeSignal?: AbortSignal;
  } = {},
): Promise<StudioSmudgeWorkerClientResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let operationTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioSmudgeWorkerRunMessage = {
      type: "studio-smudge/run",
      version: STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION,
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
        worker.postMessage(message, studioSmudgeRequestTransfers(message));
        if (!settled) {
          operationTimer = setTimeout(
            onOperationTimeout,
            boundedTimeout(options.operationTimeoutMilliseconds, DEFAULT_OPERATION_TIMEOUT_MS),
          );
        }
      } catch (error) {
        finish(() => reject(
          error instanceof Error
            ? error
            : new Error("문지르기 Worker로 픽셀 소유권을 전송하지 못했습니다."),
        ));
      }
    };

    worker.onmessage = (event) => {
      if (settled) return;
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION
      ) {
        finish(() => reject(new Error("문지르기 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-smudge/ready") {
        postRequest();
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("문지르기 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-smudge/failure") {
        if (
          !response.error
          || typeof response.error !== "object"
          || typeof response.error.name !== "string"
          || typeof response.error.message !== "string"
        ) {
          finish(() => reject(new Error("문지르기 Worker가 알 수 없는 응답을 반환했습니다.")));
          return;
        }
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      if (
        response.type !== "studio-smudge/success"
        || !(response.data instanceof Uint8ClampedArray)
        || response.data.byteLength !== request.w * request.h * 4
      ) {
        finish(() => reject(new Error("문지르기 Worker 결과가 요청과 일치하지 않습니다.")));
        return;
      }
      finish(
        () => resolve({ execution: "worker", data: response.data }),
        lifecycle.keepAlive === true,
      );
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (!requestPosted) {
        rejectWorkerUnavailable(
          "문지르기 Worker가 준비되기 전에 사용할 수 없게 되었습니다.",
          event.error ?? event.message,
        );
        return;
      }
      // 픽셀 버퍼가 이미 전송(detach)돼 직접 실행으로 되돌릴 데이터가 없다.
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "문지르기 Worker 실행 중 오류가 발생했습니다.");
      finish(() => reject(error));
    };

    worker.onmessageerror = () => rejectWorkerUnavailable("문지르기 Worker 응답을 읽지 못했습니다.");

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
        () => rejectWorkerUnavailable("문지르기 Worker 준비 시간이 초과되었습니다."),
        boundedTimeout(options.readyTimeoutMilliseconds, DEFAULT_READY_TIMEOUT_MS),
      );
    }
  });
}

let sharedSmudgeWorker: StudioSmudgeWorkerLike | null = null;
let sharedSmudgeWorkerReady = false;
let sharedSmudgeWorkerEpoch = 0;
let sharedSmudgeDisposeGeneration = 0;
const sharedSmudgeQueue = createStudioAbortableSerialQueue<
  StudioSmudgeWorkerRunRequest,
  StudioSmudgeWorkerClientResult
>();
let sharedSmudgeIdleTimer: ReturnType<typeof setTimeout> | null = null;
let sharedSmudgeFlight: {
  readonly worker: StudioSmudgeWorkerLike;
  readonly epoch: number;
  readonly controller: AbortController;
} | null = null;

function clearSharedSmudgeIdleTimer(): void {
  if (sharedSmudgeIdleTimer === null) return;
  clearTimeout(sharedSmudgeIdleTimer);
  sharedSmudgeIdleTimer = null;
}

export function disposeStudioSmudgeModuleWorker(): void {
  clearSharedSmudgeIdleTimer();
  const worker = sharedSmudgeWorker;
  const flight = sharedSmudgeFlight;
  const flightOwnsWorker = worker !== null
    && flight?.worker === worker
    && flight.epoch === sharedSmudgeWorkerEpoch;
  sharedSmudgeWorker = null;
  sharedSmudgeWorkerReady = false;
  sharedSmudgeWorkerEpoch += 1;
  sharedSmudgeDisposeGeneration += 1;
  sharedSmudgeFlight = null;
  sharedSmudgeQueue.cancelPending();
  flight?.controller.abort();
  if (worker && !flightOwnsWorker) worker.terminate();
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeStudioSmudgeModuleWorker);
}

function clearSharedSmudgeWorker(
  worker: StudioSmudgeWorkerLike,
  epoch: number,
): void {
  if (sharedSmudgeWorker !== worker || sharedSmudgeWorkerEpoch !== epoch) return;
  sharedSmudgeWorker = null;
  sharedSmudgeWorkerReady = false;
  sharedSmudgeWorkerEpoch += 1;
}

function scheduleSharedSmudgeIdleDisposal(
  worker: StudioSmudgeWorkerLike,
  epoch: number,
  disposeGeneration: number,
): void {
  clearSharedSmudgeIdleTimer();
  sharedSmudgeIdleTimer = setTimeout(() => {
    sharedSmudgeIdleTimer = null;
    if (
      sharedSmudgeWorker === worker
      && sharedSmudgeWorkerEpoch === epoch
      && sharedSmudgeDisposeGeneration === disposeGeneration
      && sharedSmudgeFlight === null
    ) {
      disposeStudioSmudgeModuleWorker();
    }
  }, DEFAULT_IDLE_TIMEOUT_MS);
}

function runSmudgeWithSharedModuleWorker(
  request: StudioSmudgeWorkerRunRequest,
  options: StudioSmudgeWorkerClientOptions,
): Promise<StudioSmudgeWorkerClientResult> {
  const disposeGeneration = sharedSmudgeDisposeGeneration;
  return sharedSmudgeQueue.run(request, async (queuedRequest) => {
    if (disposeGeneration !== sharedSmudgeDisposeGeneration) throw createAbortError();
    throwIfAborted(options.signal);
    // Admission can be cancelled before this executor starts. Keep the warm Worker's idle
    // deadline until live work actually takes ownership, including the queue handoff microtask.
    clearSharedSmudgeIdleTimer();
    let creationError: unknown;
    if (!sharedSmudgeWorker) {
      try {
        sharedSmudgeWorker = createStudioSmudgeModuleWorker();
      } catch (error) {
        creationError = error;
        sharedSmudgeWorker = null;
      }
      sharedSmudgeWorkerReady = false;
      if (sharedSmudgeWorker) sharedSmudgeWorkerEpoch += 1;
    }
    const worker = sharedSmudgeWorker;
    if (!worker) {
      throw createWorkerUnavailableError("문지르기 Worker를 만들 수 없습니다.", creationError);
    }
    const epoch = sharedSmudgeWorkerEpoch;
    const controller = new AbortController();
    sharedSmudgeFlight = { worker, epoch, controller };
    try {
      const result = await runSmudgeWithWorker(worker, queuedRequest, options, {
        keepAlive: true,
        workerAlreadyReady: sharedSmudgeWorkerReady,
        disposeSignal: controller.signal,
      });
      if (result.execution === "worker") {
        if (sharedSmudgeWorker === worker && sharedSmudgeWorkerEpoch === epoch) {
          sharedSmudgeWorkerReady = true;
          scheduleSharedSmudgeIdleDisposal(worker, epoch, disposeGeneration);
        }
      } else {
        clearSharedSmudgeWorker(worker, epoch);
      }
      return result;
    } catch (error) {
      clearSharedSmudgeWorker(worker, epoch);
      throw error;
    } finally {
      if (sharedSmudgeFlight?.controller === controller) sharedSmudgeFlight = null;
    }
  }, options.signal);
}

/**
 * 문지르기 브러시의 스탬프 블렌드 루프를 직렬화된 모듈 Worker 작업으로 실행한다. 기본 Worker는
 * 다음 스트로크에서도 재사용하며, ArrayBuffer 픽셀 소유권은 요청마다 이전(detach)된다. Worker를
 * 만들지 못하면 선택한 Worker 실행을 unavailable로 종료하고 같은 요청을 직접 재실행하지 않는다.
 */
export async function runStudioSmudgeWorker(
  request: StudioSmudgeWorkerRunRequest,
  options: StudioSmudgeWorkerClientOptions = {},
): Promise<StudioSmudgeWorkerClientResult> {
  throwIfAborted(options.signal);
  const cloneSafe = cloneSafeRequest(request);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") return runSmudgeDirect(cloneSafe, options.signal);
  if (options.workerFactory === undefined) {
    return runSmudgeWithSharedModuleWorker(cloneSafe, options);
  }
  const factory = options.workerFactory;
  if (!factory) throw createWorkerUnavailableError("문지르기 Worker를 만들 수 없습니다.");

  let worker: StudioSmudgeWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("문지르기 Worker를 만들 수 없습니다.", error);
  }
  if (!worker) throw createWorkerUnavailableError("문지르기 Worker를 만들 수 없습니다.");
  return runSmudgeWithWorker(worker, cloneSafe, options);
}
