import { applyAdvancedFill } from "./studio-advanced-fill";
import { postprocessStudioAdvancedFillWorkerResult } from "./studio-advanced-fill-worker-postprocess";
import {
  STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION,
  studioAdvancedFillRequestTransfers,
  type StudioAdvancedFillWorkerResponseMessage,
  type StudioAdvancedFillWorkerRunMessage,
  type StudioAdvancedFillWorkerRunRequest,
} from "./studio-advanced-fill-worker-protocol";

import type { AdvancedFillImageDataLike, AdvancedFillResult } from "./studio-advanced-fill";

export interface StudioAdvancedFillWorkerLike {
  onmessage: ((event: MessageEvent<StudioAdvancedFillWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioAdvancedFillWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioAdvancedFillWorkerFactory = () => StudioAdvancedFillWorkerLike | null;
export type StudioAdvancedFillExecutionMode = "worker" | "direct";

export interface StudioAdvancedFillWorkerClientOptions {
  signal?: AbortSignal;
  /** Selects one execution authority before the request starts. It never changes mid-request. */
  executionMode?: StudioAdvancedFillExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  workerFactory?: StudioAdvancedFillWorkerFactory | null;
}

export interface StudioAdvancedFillWorkerClientResult {
  execution: "worker" | "direct";
  /** Original target pixels returned from the worker after transfer, for edge blending/diagnostics. */
  originalTarget: AdvancedFillImageDataLike;
  result: AdvancedFillResult;
}

export const STUDIO_ADVANCED_FILL_DIRECT_MAX_PIXELS = 4 * 1024 * 1024;

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioAdvancedFillModuleWorker(): StudioAdvancedFillWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-advanced-fill.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-advanced-fill",
  }) as unknown as StudioAdvancedFillWorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("고급 채우기를 취소했습니다.", "AbortError");
  }
  const error = new Error("고급 채우기를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(
    message,
    cause === undefined ? undefined : { cause },
  );
  error.name = "StudioAdvancedFillWorkerUnavailableError";
  return error;
}

/**
 * Narrows browser-owned pixel wrappers to the protocol's clone-safe data contract. Callers may
 * attach lifecycle helpers such as `release()` to their ImageData-like objects; posting those
 * functions would raise DataCloneError and make the selected Worker request fail closed.
 */
function cloneSafeWorkerRequest(
  request: StudioAdvancedFillWorkerRunRequest,
): StudioAdvancedFillWorkerRunRequest {
  return {
    target: {
      data: request.target.data,
      width: request.target.width,
      height: request.target.height,
    },
    referenceImage: request.referenceImage
      ? {
          data: request.referenceImage.data,
          width: request.referenceImage.width,
          height: request.referenceImage.height,
        }
      : undefined,
    referenceMask: request.referenceMask
      ? {
          data: request.referenceMask.data,
          width: request.referenceMask.width,
          height: request.referenceMask.height,
        }
      : undefined,
    seeds: request.seeds.map((seed) => ({ x: seed.x, y: seed.y })),
    fill: [request.fill[0], request.fill[1], request.fill[2], request.fill[3]],
    options: request.options ? { ...request.options } : undefined,
    softenEdges: request.softenEdges === true,
    enforceAlphaLock: request.enforceAlphaLock === true,
    alphaLockSource: request.alphaLockSource
      ? {
          data: request.alphaLockSource.data,
          width: request.alphaLockSource.width,
          height: request.alphaLockSource.height,
        }
      : undefined,
  };
}

function runAdvancedFillDirect(
  request: StudioAdvancedFillWorkerRunRequest,
  signal: AbortSignal | undefined,
): StudioAdvancedFillWorkerClientResult {
  throwIfAborted(signal);
  if (request.target.width * request.target.height > STUDIO_ADVANCED_FILL_DIRECT_MAX_PIXELS) {
    throw new RangeError(
      "이 브라우저는 고급 채우기 Worker를 사용할 수 없어 직접 계산 안전 상한(4,194,304픽셀)을 적용합니다. 이미지를 나누거나 해상도를 낮춰 주세요.",
    );
  }
  const rawResult = applyAdvancedFill({ ...request, abort: signal });
  if (signal?.aborted || rawResult.diagnostics.status === "aborted") throw createAbortError();
  const result = postprocessStudioAdvancedFillWorkerResult(request, rawResult);
  return { execution: "direct", originalTarget: request.target, result };
}

function deserializeWorkerError(response: Extract<
  StudioAdvancedFillWorkerResponseMessage,
  { type: "studio-advanced-fill/failure" }
>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runAdvancedFillWithWorker(
  worker: StudioAdvancedFillWorkerLike,
  request: StudioAdvancedFillWorkerRunRequest,
  signal: AbortSignal | undefined,
): Promise<StudioAdvancedFillWorkerClientResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioAdvancedFillWorkerRunMessage = {
      type: "studio-advanced-fill/run",
      version: STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION,
      request,
    };

    const cleanup = () => {
      if (readyTimer !== null) clearTimeout(readyTimer);
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));
    worker.onmessage = (event) => {
      const response = event.data;
      if (response.version !== STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION) {
        finish(() => reject(new Error("고급 채우기 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-advanced-fill/ready") {
        if (requestPosted) return;
        if (readyTimer !== null) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        try {
          worker.postMessage(message, studioAdvancedFillRequestTransfers(message));
          requestPosted = true;
        } catch (error) {
          // No ownership transfer occurs when postMessage throws synchronously.
          finish(() => reject(createWorkerUnavailableError(
            "고급 채우기 Worker에 요청을 전달하지 못했습니다.",
            error,
          )));
        }
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("고급 채우기 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-advanced-fill/failure") {
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      finish(() =>
        resolve({
          execution: "worker",
          originalTarget: response.originalTarget,
          result: response.result,
        }),
      );
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const error =
        event.error instanceof Error
          ? event.error
          : createWorkerUnavailableError(
              event.message || (requestPosted
                ? "고급 채우기 Worker 실행 중 오류가 발생했습니다."
                : "고급 채우기 Worker를 준비하지 못했습니다."),
            );
      finish(() => reject(error));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    readyTimer = setTimeout(
      () => finish(() => reject(createWorkerUnavailableError(
        "고급 채우기 Worker가 준비 시간 안에 응답하지 않았습니다.",
      ))),
      3_000,
    );
  });
}

/**
 * Runs Advanced Fill in a one-shot module worker. Ordinary ArrayBuffer-backed target, reference,
 * and mask views are consumed (detached) and transferred without copying. The original target is
 * transferred back with the result; reference/mask buffers are intentionally not returned.
 */
export async function runStudioAdvancedFillWorker(
  request: StudioAdvancedFillWorkerRunRequest,
  options: StudioAdvancedFillWorkerClientOptions = {},
): Promise<StudioAdvancedFillWorkerClientResult> {
  throwIfAborted(options.signal);
  const cloneSafeRequest = cloneSafeWorkerRequest(request);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") {
    return runAdvancedFillDirect(cloneSafeRequest, options.signal);
  }
  const factory =
    options.workerFactory === undefined
      ? createStudioAdvancedFillModuleWorker
      : options.workerFactory;
  if (!factory) {
    throw createWorkerUnavailableError("고급 채우기 Worker를 사용할 수 없습니다.");
  }

  let worker: StudioAdvancedFillWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("고급 채우기 Worker를 만들지 못했습니다.", error);
  }
  if (!worker) {
    throw createWorkerUnavailableError("고급 채우기 Worker를 사용할 수 없습니다.");
  }
  return runAdvancedFillWithWorker(worker, cloneSafeRequest, options.signal);
}
