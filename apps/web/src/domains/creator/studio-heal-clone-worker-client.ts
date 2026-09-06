import { applyHealCloneDabsFromSeparateRegions } from "./studio-heal-clone";
import {
  STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION,
  assertStudioHealCloneImageData,
  assertStudioHealCloneWorkerRequest,
  studioHealCloneRequestTransfers,
  type StudioHealCloneWorkerResponseMessage,
  type StudioHealCloneWorkerRunMessage,
  type StudioHealCloneWorkerRunRequest,
} from "./studio-heal-clone-worker-protocol";

import type { StudioImageDataLike } from "./studio-filters";

export interface StudioHealCloneWorkerLike {
  onmessage: ((event: MessageEvent<StudioHealCloneWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioHealCloneWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioHealCloneWorkerFactory = () => StudioHealCloneWorkerLike | null;
export type StudioHealCloneExecutionMode = "worker" | "direct";

export interface StudioHealCloneWorkerClientOptions {
  signal?: AbortSignal;
  /** Execution authority is selected before the operation starts and never changes afterward. */
  executionMode?: StudioHealCloneExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  workerFactory?: StudioHealCloneWorkerFactory | null;
  readyTimeoutMilliseconds?: number;
  operationTimeoutMilliseconds?: number;
}

export interface StudioHealCloneWorkerClientResult {
  execution: "worker" | "direct";
  dst: StudioImageDataLike;
}

const DEFAULT_READY_TIMEOUT_MS = 3_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioHealCloneModuleWorker(): StudioHealCloneWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-heal-clone.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-heal-clone",
  }) as unknown as StudioHealCloneWorkerLike;
}

function createAbortError(message = "복구 브러시 계산을 취소했습니다."): Error {
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function createTimeoutError(): Error {
  const error = new Error("복구 브러시 Worker가 제한 시간 안에 완료되지 않았습니다.");
  error.name = "TimeoutError";
  return error;
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "StudioHealCloneWorkerUnavailableError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(120_000, Math.round(value!)));
}

function transferableView(
  view: Uint8ClampedArray,
  claimedBuffers: Set<ArrayBuffer>,
): Uint8ClampedArray {
  const buffer = view.buffer;
  const canTransferWithoutOversharing =
    buffer instanceof ArrayBuffer
    && view.byteOffset === 0
    && view.byteLength === buffer.byteLength
    && !claimedBuffers.has(buffer);
  if (canTransferWithoutOversharing) {
    claimedBuffers.add(buffer);
    return view;
  }
  return new Uint8ClampedArray(view);
}

/** 부분/shared view를 격리하고 frozen source와 mutable destination의 소유권을 항상 분리한다. */
function cloneSafeRequest(
  request: StudioHealCloneWorkerRunRequest,
): StudioHealCloneWorkerRunRequest {
  assertStudioHealCloneWorkerRequest(request);
  const claimedBuffers = new Set<ArrayBuffer>();
  return {
    src: {
      data: transferableView(request.src.data, claimedBuffers),
      width: request.src.width,
      height: request.src.height,
    },
    dst: {
      data: transferableView(request.dst.data, claimedBuffers),
      width: request.dst.width,
      height: request.dst.height,
    },
    dabs: request.dabs.map((dab) => ({ ...dab })),
    radiusPx: request.radiusPx,
    hardness: request.hardness,
    opacity: request.opacity,
    mode: request.mode,
  };
}

function runHealCloneDirect(
  request: StudioHealCloneWorkerRunRequest,
  signal: AbortSignal | undefined,
): StudioHealCloneWorkerClientResult {
  throwIfAborted(signal);
  applyHealCloneDabsFromSeparateRegions(
    request.src,
    request.dst,
    request.dabs,
    request.radiusPx,
    request.hardness,
    request.opacity,
    request.mode,
  );
  throwIfAborted(signal);
  return { execution: "direct", dst: request.dst };
}

function deserializeWorkerError(response: Extract<
  StudioHealCloneWorkerResponseMessage,
  { type: "studio-heal-clone/failure" }
>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runHealCloneWithWorker(
  worker: StudioHealCloneWorkerLike,
  request: StudioHealCloneWorkerRunRequest,
  options: StudioHealCloneWorkerClientOptions,
  lifecycle: {
    readonly keepAlive?: boolean;
    readonly workerAlreadyReady?: boolean;
    readonly disposeSignal?: AbortSignal;
  } = {},
): Promise<StudioHealCloneWorkerClientResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let operationTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioHealCloneWorkerRunMessage = {
      type: "studio-heal-clone/run",
      version: STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION,
      request,
    };

    const cleanup = (keepWorker = false) => {
      if (readyTimer !== null) clearTimeout(readyTimer);
      if (operationTimer !== null) clearTimeout(operationTimer);
      signal?.removeEventListener("abort", onAbort);
      lifecycle.disposeSignal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
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
    const rejectMalformedResponse = () => finish(() => reject(
      new Error("복구 브러시 Worker가 알 수 없는 응답을 반환했습니다."),
    ));
    const onOperationTimeout = () => finish(() => reject(createTimeoutError()));

    const postRequest = () => {
      if (requestPosted || settled) return;
      if (readyTimer !== null) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      try {
        // 동기 응답 Worker도 허용하고, postMessage가 소유권 이전 뒤 throw할 수 있는 경계로 취급한다.
        requestPosted = true;
        worker.postMessage(message, studioHealCloneRequestTransfers(message));
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
            : new Error("복구 브러시 Worker로 픽셀 소유권을 전송하지 못했습니다."),
        ));
      }
    };

    worker.onmessage = (event) => {
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION
      ) {
        rejectMalformedResponse();
        return;
      }
      if (response.type === "studio-heal-clone/ready") {
        postRequest();
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("복구 브러시 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-heal-clone/failure") {
        if (
          !response.error
          || typeof response.error !== "object"
          || typeof response.error.name !== "string"
          || typeof response.error.message !== "string"
        ) {
          rejectMalformedResponse();
          return;
        }
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      if (response.type !== "studio-heal-clone/success") {
        rejectMalformedResponse();
        return;
      }
      try {
        assertStudioHealCloneImageData(response.dst, "복구 브러시 Worker 결과");
        if (
          response.dst.width !== request.dst.width
          || response.dst.height !== request.dst.height
        ) {
          throw new RangeError("복구 브러시 Worker 결과 크기가 요청과 일치하지 않습니다.");
        }
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      finish(
        () => resolve({ execution: "worker", dst: response.dst }),
        lifecycle.keepAlive === true,
      );
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (!requestPosted) {
        rejectWorkerUnavailable(
          "복구 브러시 Worker가 준비되기 전에 사용할 수 없게 되었습니다.",
          event.error ?? event.message,
        );
        return;
      }
      // 픽셀 버퍼가 이미 전송(detach)됐으므로 직접 실행으로 되돌리지 않고 이 Worker epoch를 폐기한다.
      const error = event.error instanceof Error
        ? event.error
        : new Error(event.message || "복구 브러시 Worker 실행 중 오류가 발생했습니다.");
      finish(() => reject(error));
    };

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
        () => rejectWorkerUnavailable("복구 브러시 Worker 준비 시간이 초과되었습니다."),
        boundedTimeout(options.readyTimeoutMilliseconds, DEFAULT_READY_TIMEOUT_MS),
      );
    }
  });
}

let sharedHealCloneWorker: StudioHealCloneWorkerLike | null = null;
let sharedHealCloneWorkerReady = false;
let sharedHealCloneWorkerEpoch = 0;
let sharedHealCloneDisposeGeneration = 0;
let sharedHealCloneQueue: Promise<void> = Promise.resolve();
let sharedHealCloneIdleTimer: ReturnType<typeof setTimeout> | null = null;
let sharedHealCloneFlight: {
  readonly worker: StudioHealCloneWorkerLike;
  readonly epoch: number;
  readonly controller: AbortController;
} | null = null;

function clearSharedHealCloneIdleTimer(): void {
  if (sharedHealCloneIdleTimer === null) return;
  clearTimeout(sharedHealCloneIdleTimer);
  sharedHealCloneIdleTimer = null;
}

/** Releases the warm module Worker for route/HMR teardown and deterministic tests. */
export function disposeStudioHealCloneModuleWorker(): void {
  clearSharedHealCloneIdleTimer();
  const worker = sharedHealCloneWorker;
  const flight = sharedHealCloneFlight;
  const flightOwnsWorker = worker !== null
    && flight?.worker === worker
    && flight.epoch === sharedHealCloneWorkerEpoch;
  sharedHealCloneWorker = null;
  sharedHealCloneWorkerReady = false;
  sharedHealCloneWorkerEpoch += 1;
  sharedHealCloneDisposeGeneration += 1;
  sharedHealCloneFlight = null;
  flight?.controller.abort();
  if (worker && !flightOwnsWorker) worker.terminate();
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeStudioHealCloneModuleWorker);
}

function clearSharedHealCloneWorker(
  worker: StudioHealCloneWorkerLike,
  epoch: number,
): void {
  if (sharedHealCloneWorker !== worker || sharedHealCloneWorkerEpoch !== epoch) return;
  // runHealCloneWithWorker가 모든 비성공 경로에서 terminate한다. 여기서는 오래된 flight가 새
  // HMR/recovery Worker를 지우지 못하도록 epoch 소유권만 무효화한다.
  sharedHealCloneWorker = null;
  sharedHealCloneWorkerReady = false;
  sharedHealCloneWorkerEpoch += 1;
}

function scheduleSharedHealCloneIdleDisposal(
  worker: StudioHealCloneWorkerLike,
  epoch: number,
  disposeGeneration: number,
): void {
  clearSharedHealCloneIdleTimer();
  sharedHealCloneIdleTimer = setTimeout(() => {
    sharedHealCloneIdleTimer = null;
    if (
      sharedHealCloneWorker === worker
      && sharedHealCloneWorkerEpoch === epoch
      && sharedHealCloneDisposeGeneration === disposeGeneration
      && sharedHealCloneFlight === null
    ) {
      disposeStudioHealCloneModuleWorker();
    }
  }, DEFAULT_IDLE_TIMEOUT_MS);
}

function runHealCloneWithSharedModuleWorker(
  request: StudioHealCloneWorkerRunRequest,
  options: StudioHealCloneWorkerClientOptions,
): Promise<StudioHealCloneWorkerClientResult> {
  const disposeGeneration = sharedHealCloneDisposeGeneration;
  clearSharedHealCloneIdleTimer();
  const operation = sharedHealCloneQueue.then(async () => {
    clearSharedHealCloneIdleTimer();
    if (disposeGeneration !== sharedHealCloneDisposeGeneration) throw createAbortError();
    throwIfAborted(options.signal);
    let creationError: unknown;
    if (!sharedHealCloneWorker) {
      try {
        sharedHealCloneWorker = createStudioHealCloneModuleWorker();
      } catch (error) {
        creationError = error;
        sharedHealCloneWorker = null;
      }
      sharedHealCloneWorkerReady = false;
      if (sharedHealCloneWorker) sharedHealCloneWorkerEpoch += 1;
    }
    const worker = sharedHealCloneWorker;
    if (!worker) {
      throw createWorkerUnavailableError("복구 브러시 Worker를 만들 수 없습니다.", creationError);
    }
    const epoch = sharedHealCloneWorkerEpoch;
    const controller = new AbortController();
    sharedHealCloneFlight = { worker, epoch, controller };
    try {
      const result = await runHealCloneWithWorker(worker, request, options, {
        keepAlive: true,
        workerAlreadyReady: sharedHealCloneWorkerReady,
        disposeSignal: controller.signal,
      });
      if (result.execution === "worker") {
        if (sharedHealCloneWorker === worker && sharedHealCloneWorkerEpoch === epoch) {
          sharedHealCloneWorkerReady = true;
          scheduleSharedHealCloneIdleDisposal(worker, epoch, disposeGeneration);
        }
      } else {
        clearSharedHealCloneWorker(worker, epoch);
      }
      return result;
    } catch (error) {
      clearSharedHealCloneWorker(worker, epoch);
      throw error;
    } finally {
      if (sharedHealCloneFlight?.controller === controller) sharedHealCloneFlight = null;
    }
  });
  sharedHealCloneQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/**
 * 복구 브러시/도장 도장 적용을 capacity 1 모듈 Worker 큐에서 실행한다. 기본 Worker는 첫 ready
 * 이후 스트로크 간 유지되며, 명시적 workerFactory만 격리된 one-shot 수명을 사용한다. ArrayBuffer
 * 픽셀 소유권은 요청마다 이전한다. Worker를 만들 수 없거나 준비 전에 로드가 실패하면 선택한
 * Worker 실행은 unavailable로 종료되며 같은 요청을 메인 스레드에서 다시 실행하지 않는다.
 */
export async function runStudioHealCloneWorker(
  request: StudioHealCloneWorkerRunRequest,
  options: StudioHealCloneWorkerClientOptions = {},
): Promise<StudioHealCloneWorkerClientResult> {
  throwIfAborted(options.signal);
  const cloneSafe = cloneSafeRequest(request);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") return runHealCloneDirect(cloneSafe, options.signal);
  if (options.workerFactory === undefined) {
    return runHealCloneWithSharedModuleWorker(cloneSafe, options);
  }
  const factory = options.workerFactory;
  if (!factory) throw createWorkerUnavailableError("복구 브러시 Worker를 만들 수 없습니다.");

  let worker: StudioHealCloneWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("복구 브러시 Worker를 만들 수 없습니다.", error);
  }
  if (!worker) throw createWorkerUnavailableError("복구 브러시 Worker를 만들 수 없습니다.");
  return runHealCloneWithWorker(worker, cloneSafe, options);
}
