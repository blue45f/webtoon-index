import {
  STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION,
  assertStudioLiquifyImageData,
  assertStudioLiquifyRequest,
  studioLiquifyRequestTransfers,
  type StudioLiquifyWorkerResponseMessage,
  type StudioLiquifyWorkerRunMessage,
  type StudioLiquifyWorkerRunRequest,
} from "./studio-liquify-worker-protocol";

import type { StudioImageDataLike } from "./studio-filters";

export interface StudioLiquifyWorkerLike {
  onmessage: ((event: MessageEvent<StudioLiquifyWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioLiquifyWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioLiquifyWorkerFactory = () => StudioLiquifyWorkerLike | null;
export type StudioLiquifyExecutionMode = "worker" | "direct";

export interface StudioLiquifyWorkerClientOptions {
  signal?: AbortSignal;
  /** Execution authority is selected before the operation starts and never changes afterward. */
  executionMode?: StudioLiquifyExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  workerFactory?: StudioLiquifyWorkerFactory | null;
  readyTimeoutMilliseconds?: number;
  operationTimeoutMilliseconds?: number;
}

export interface StudioLiquifyWorkerClientResult {
  execution: "worker" | "direct";
  /** false면 스트로크가 유효한 변위 필드를 만들지 못해 dst가 원본 그대로다. */
  applied: boolean;
  dst: StudioImageDataLike;
}

const DEFAULT_READY_TIMEOUT_MS = 3_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;
const DEFAULT_IDLE_TIMEOUT_MS = 45_000;

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioLiquifyModuleWorker(): StudioLiquifyWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-liquify.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-liquify",
  }) as unknown as StudioLiquifyWorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("리퀴파이 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("리퀴파이 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function createTimeoutError(): Error {
  const error = new Error("리퀴파이 Worker가 제한 시간 안에 완료되지 않았습니다.");
  error.name = "TimeoutError";
  return error;
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "StudioLiquifyWorkerUnavailableError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(120_000, Math.round(value!)));
}

function transferableView<T extends Uint8ClampedArray | Float32Array>(
  view: T,
  claimedBuffers: Set<ArrayBuffer>,
): T {
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
  return new (view.constructor as { new (source: ArrayLike<number>): T })(view);
}

/** 부분/shared view가 무관한 메모리를 detach·노출하지 않고 src/dst가 항상 분리되게 한다. */
function cloneSafeLiquifyRequest(request: StudioLiquifyWorkerRunRequest): StudioLiquifyWorkerRunRequest {
  assertStudioLiquifyRequest(request);
  const claimedBuffers = new Set<ArrayBuffer>();
  const pixels = {
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
    ...(request.region === undefined ? {} : { region: { ...request.region } }),
  };
  if ("stroke" in request) {
    return {
      ...pixels,
      stroke: {
        points: request.stroke.points.map((point) => ({
          x: point.x,
          y: point.y,
          ...(point.pressure === undefined ? {} : { pressure: point.pressure }),
        })),
        radiusPx: request.stroke.radiusPx,
        strength: request.stroke.strength,
        ...(request.stroke.options === undefined ? {} : { options: { ...request.stroke.options } }),
      },
    };
  }
  return {
    ...pixels,
    field: {
      originX: request.field.originX,
      originY: request.field.originY,
      width: request.field.width,
      height: request.field.height,
      // A retained displacement field is caller-owned session state. Unlike src/dst, it must be
      // reusable for reconstruct/smooth/refine after this Worker request, so always transfer
      // private copies even when the original views happen to span whole ArrayBuffers.
      dx: new Float32Array(request.field.dx),
      dy: new Float32Array(request.field.dy),
    },
  };
}

async function runLiquifyDirect(
  request: StudioLiquifyWorkerRunRequest,
  signal: AbortSignal | undefined,
): Promise<StudioLiquifyWorkerClientResult> {
  throwIfAborted(signal);
  // Direct is an independently selected mode and is never entered after Worker failure.
  const { applyLiquifyDisplacement, buildLiquifyDisplacementField } = await import("./studio-liquify");
  throwIfAborted(signal);
  const field = "stroke" in request
    ? buildLiquifyDisplacementField(
        request.stroke.points,
        request.stroke.radiusPx,
        request.stroke.strength,
        request.region?.canvasWidth ?? request.src.width,
        request.region?.canvasHeight ?? request.src.height,
        { ...request.stroke.options, signal },
      )
    : request.field;
  if (!field) return { execution: "direct", applied: false, dst: request.dst };
  applyLiquifyDisplacement(request.src, request.dst, field, {
    signal,
    ...(request.region === undefined ? {} : { region: request.region }),
  });
  return { execution: "direct", applied: true, dst: request.dst };
}

function deserializeWorkerError(response: Extract<
  StudioLiquifyWorkerResponseMessage,
  { type: "studio-liquify/failure" }
>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runLiquifyWithWorker(
  worker: StudioLiquifyWorkerLike,
  request: StudioLiquifyWorkerRunRequest,
  options: StudioLiquifyWorkerClientOptions,
  lifecycle: {
    readonly keepAlive?: boolean;
    readonly workerAlreadyReady?: boolean;
    readonly disposeSignal?: AbortSignal;
  } = {},
): Promise<StudioLiquifyWorkerClientResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options;
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let operationTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioLiquifyWorkerRunMessage = {
      type: "studio-liquify/run",
      version: STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION,
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

    const onOperationTimeout = () => finish(() => reject(createTimeoutError()));

    const postRequest = () => {
      if (requestPosted || settled) return;
      if (readyTimer !== null) {
        clearTimeout(readyTimer);
        readyTimer = null;
      }
      try {
        requestPosted = true;
        worker.postMessage(message, studioLiquifyRequestTransfers(message));
        if (!settled) {
          operationTimer = setTimeout(
            onOperationTimeout,
            boundedTimeout(options.operationTimeoutMilliseconds, DEFAULT_OPERATION_TIMEOUT_MS),
          );
        }
      } catch (error) {
        // postMessage 구현은 소유권을 detach한 뒤 예외를 던질 수도 있다. 이 경계 뒤에는 direct
        // 실행이 안전하지 않으므로 실패로 닫고 공유 Worker epoch를 폐기한다.
        finish(() => reject(
          error instanceof Error
            ? error
            : new Error("리퀴파이 Worker로 픽셀 소유권을 전송하지 못했습니다."),
        ));
      }
    };

    worker.onmessage = (event) => {
      const response = event.data;
      if (
        !response
        || typeof response !== "object"
        || response.version !== STUDIO_LIQUIFY_WORKER_PROTOCOL_VERSION
      ) {
        finish(() => reject(new Error("리퀴파이 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-liquify/ready") {
        postRequest();
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("리퀴파이 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-liquify/failure") {
        if (
          !response.error
          || typeof response.error !== "object"
          || typeof response.error.name !== "string"
          || typeof response.error.message !== "string"
        ) {
          finish(() => reject(new Error("리퀴파이 Worker가 알 수 없는 응답을 반환했습니다.")));
          return;
        }
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      if (response.type !== "studio-liquify/success") {
        finish(() => reject(new Error("리퀴파이 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      try {
        assertStudioLiquifyImageData(response.dst, "리퀴파이 Worker 결과");
        if (typeof response.applied !== "boolean") {
          throw new TypeError("리퀴파이 Worker 적용 여부가 올바르지 않습니다.");
        }
        if (response.dst.width !== request.dst.width || response.dst.height !== request.dst.height) {
          throw new RangeError("리퀴파이 Worker 결과 크기가 요청과 일치하지 않습니다.");
        }
      } catch (error) {
        finish(() => reject(error));
        return;
      }
      finish(
        () => resolve({ execution: "worker", applied: response.applied, dst: response.dst }),
        lifecycle.keepAlive === true,
      );
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (!requestPosted) {
        rejectWorkerUnavailable(
          "리퀴파이 Worker가 준비되기 전에 사용할 수 없게 되었습니다.",
          event.error ?? event.message,
        );
        return;
      }
      // 픽셀 버퍼가 이미 전송(detach)돼 직접 실행으로 되돌릴 데이터가 없다.
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "리퀴파이 Worker 실행 중 오류가 발생했습니다.");
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
        () => rejectWorkerUnavailable("리퀴파이 Worker 준비 시간이 초과되었습니다."),
        boundedTimeout(options.readyTimeoutMilliseconds, DEFAULT_READY_TIMEOUT_MS),
      );
    }
  });
}

let sharedLiquifyWorker: StudioLiquifyWorkerLike | null = null;
let sharedLiquifyWorkerReady = false;
let sharedLiquifyWorkerEpoch = 0;
let sharedLiquifyDisposeGeneration = 0;
let sharedLiquifyQueue: Promise<void> = Promise.resolve();
let sharedLiquifyIdleTimer: ReturnType<typeof setTimeout> | null = null;
let sharedLiquifyFlight: {
  readonly worker: StudioLiquifyWorkerLike;
  readonly epoch: number;
  readonly controller: AbortController;
} | null = null;

function clearSharedLiquifyIdleTimer(): void {
  if (sharedLiquifyIdleTimer === null) return;
  clearTimeout(sharedLiquifyIdleTimer);
  sharedLiquifyIdleTimer = null;
}

/** Releases the warm module Worker for route/HMR teardown and deterministic tests. */
export function disposeStudioLiquifyModuleWorker(): void {
  clearSharedLiquifyIdleTimer();
  const worker = sharedLiquifyWorker;
  const flight = sharedLiquifyFlight;
  const flightOwnsWorker = worker !== null
    && flight?.worker === worker
    && flight.epoch === sharedLiquifyWorkerEpoch;
  sharedLiquifyWorker = null;
  sharedLiquifyWorkerReady = false;
  sharedLiquifyWorkerEpoch += 1;
  sharedLiquifyDisposeGeneration += 1;
  sharedLiquifyFlight = null;
  flight?.controller.abort();
  if (worker && !flightOwnsWorker) worker.terminate();
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeStudioLiquifyModuleWorker);
}

function clearSharedLiquifyWorker(
  worker: StudioLiquifyWorkerLike,
  epoch: number,
): void {
  if (sharedLiquifyWorker !== worker || sharedLiquifyWorkerEpoch !== epoch) return;
  // runLiquifyWithWorker already terminated every non-success path. Only invalidate ownership here
  // so an older flight can never clear a newer HMR/recovery Worker.
  sharedLiquifyWorker = null;
  sharedLiquifyWorkerReady = false;
  sharedLiquifyWorkerEpoch += 1;
}

function scheduleSharedLiquifyIdleDisposal(
  worker: StudioLiquifyWorkerLike,
  epoch: number,
  disposeGeneration: number,
): void {
  clearSharedLiquifyIdleTimer();
  sharedLiquifyIdleTimer = setTimeout(() => {
    sharedLiquifyIdleTimer = null;
    if (
      sharedLiquifyWorker === worker
      && sharedLiquifyWorkerEpoch === epoch
      && sharedLiquifyDisposeGeneration === disposeGeneration
      && sharedLiquifyFlight === null
    ) {
      disposeStudioLiquifyModuleWorker();
    }
  }, DEFAULT_IDLE_TIMEOUT_MS);
}

function runLiquifyWithSharedModuleWorker(
  request: StudioLiquifyWorkerRunRequest,
  options: StudioLiquifyWorkerClientOptions,
): Promise<StudioLiquifyWorkerClientResult> {
  const disposeGeneration = sharedLiquifyDisposeGeneration;
  clearSharedLiquifyIdleTimer();
  const operation = sharedLiquifyQueue.then(async () => {
    clearSharedLiquifyIdleTimer();
    if (disposeGeneration !== sharedLiquifyDisposeGeneration) throw createAbortError();
    throwIfAborted(options.signal);
    let creationError: unknown;
    if (!sharedLiquifyWorker) {
      try {
        sharedLiquifyWorker = createStudioLiquifyModuleWorker();
      } catch (error) {
        creationError = error;
        sharedLiquifyWorker = null;
      }
      sharedLiquifyWorkerReady = false;
      if (sharedLiquifyWorker) sharedLiquifyWorkerEpoch += 1;
    }
    const worker = sharedLiquifyWorker;
    if (!worker) {
      throw createWorkerUnavailableError("리퀴파이 Worker를 만들 수 없습니다.", creationError);
    }
    const epoch = sharedLiquifyWorkerEpoch;
    const controller = new AbortController();
    sharedLiquifyFlight = { worker, epoch, controller };
    try {
      const result = await runLiquifyWithWorker(worker, request, options, {
        keepAlive: true,
        workerAlreadyReady: sharedLiquifyWorkerReady,
        disposeSignal: controller.signal,
      });
      if (result.execution === "worker") {
        if (sharedLiquifyWorker === worker && sharedLiquifyWorkerEpoch === epoch) {
          sharedLiquifyWorkerReady = true;
          scheduleSharedLiquifyIdleDisposal(worker, epoch, disposeGeneration);
        }
      } else {
        clearSharedLiquifyWorker(worker, epoch);
      }
      return result;
    } catch (error) {
      clearSharedLiquifyWorker(worker, epoch);
      throw error;
    } finally {
      if (sharedLiquifyFlight?.controller === controller) sharedLiquifyFlight = null;
    }
  });
  sharedLiquifyQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/**
 * 리퀴파이 필드 생성과 변위 적용(backward mapping + bilinear 샘플링)을 capacity 1 모듈 Worker
 * 큐에서 실행한다. 기본 Worker는 첫 ready 이후 스트로크 간 유지되며, 명시적 workerFactory만 기존
 * 격리된 one-shot 수명을 사용한다. Reconstruct/Smooth의 field 요청도 기존대로 지원한다. Worker를
 * 만들지 못하거나 실행이 실패하면 해당 요청은 unavailable/reject로 끝나며 backend를 바꾸지 않는다.
 */
export async function runStudioLiquifyWorker(
  request: StudioLiquifyWorkerRunRequest,
  options: StudioLiquifyWorkerClientOptions = {},
): Promise<StudioLiquifyWorkerClientResult> {
  throwIfAborted(options.signal);
  const cloneSafeRequest = cloneSafeLiquifyRequest(request);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") return runLiquifyDirect(cloneSafeRequest, options.signal);
  if (options.workerFactory === undefined) {
    return runLiquifyWithSharedModuleWorker(cloneSafeRequest, options);
  }
  const factory = options.workerFactory;
  if (!factory) throw createWorkerUnavailableError("리퀴파이 Worker를 만들 수 없습니다.");

  let worker: StudioLiquifyWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("리퀴파이 Worker를 만들 수 없습니다.", error);
  }
  if (!worker) throw createWorkerUnavailableError("리퀴파이 Worker를 만들 수 없습니다.");
  return runLiquifyWithWorker(worker, cloneSafeRequest, options);
}
