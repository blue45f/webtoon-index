import {
  STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
  isStudioVrmTextureFillRequest,
  isStudioVrmTextureFillWorkerResponseMessage,
  studioVrmTextureFillRequestTransfers,
  type StudioVrmTextureFillWorkerFailureMessage,
  type StudioVrmTextureFillWorkerRunMessage,
} from "./studio-vrm-texture-fill-worker-protocol";

import type {
  StudioVrmTextureFillRequest,
  StudioVrmTextureFillResult,
} from "./studio-vrm-texture-fill";

export const STUDIO_VRM_TEXTURE_FILL_WORKER_DEFAULT_READY_TIMEOUT_MS = 3_000;
export const STUDIO_VRM_TEXTURE_FILL_WORKER_MAX_READY_TIMEOUT_MS = 30_000;

export type StudioVrmTextureFillWorkerClientErrorCode =
  | "invalid-request"
  | "worker-post-failed"
  | "worker-protocol"
  | "worker-runtime"
  | "worker-timeout"
  | "worker-unavailable";

export class StudioVrmTextureFillWorkerClientError extends Error {
  constructor(
    readonly code: StudioVrmTextureFillWorkerClientErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code === "worker-timeout"
      ? "TimeoutError"
      : code === "worker-unavailable"
        ? "NotSupportedError"
      : "StudioVrmTextureFillWorkerClientError";
  }
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  readonly error?: unknown;
  readonly message?: string;
  preventDefault?(): void;
}

export interface StudioVrmTextureFillWorkerLike {
  onmessage: ((event: WorkerMessageEventLike) => void) | null;
  onerror: ((event: WorkerErrorEventLike) => void) | null;
  onmessageerror: ((event: WorkerMessageEventLike) => void) | null;
  postMessage(message: StudioVrmTextureFillWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioVrmTextureFillWorkerFactory =
  () => StudioVrmTextureFillWorkerLike | null;

export interface StudioVrmTextureFillWorkerClientOptions {
  readonly signal?: AbortSignal;
  readonly workerFactory?: StudioVrmTextureFillWorkerFactory | null;
  readonly readyTimeoutMs?: number;
}

export type RunStudioVrmTextureFillWorkerOptions =
  StudioVrmTextureFillWorkerClientOptions;

export interface StudioVrmTextureFillWorkerClientResult {
  readonly execution: "worker";
  readonly result: StudioVrmTextureFillResult;
}

/** Vite statically discovers this exact URL and emits a dedicated one-shot module Worker. */
export function createStudioVrmTextureFillModuleWorker(): StudioVrmTextureFillWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-vrm-texture-fill.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-vrm-texture-fill",
  }) as unknown as StudioVrmTextureFillWorkerLike;
}

function abortError(): Error {
  const message = "3D 표면 채우기 계산을 취소했습니다.";
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function clientError(
  code: StudioVrmTextureFillWorkerClientErrorCode,
  message: string,
  cause?: unknown,
): StudioVrmTextureFillWorkerClientError {
  return new StudioVrmTextureFillWorkerClientError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function normalizedReadyTimeoutMs(value: number | undefined): number {
  const timeout = value ?? STUDIO_VRM_TEXTURE_FILL_WORKER_DEFAULT_READY_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > STUDIO_VRM_TEXTURE_FILL_WORKER_MAX_READY_TIMEOUT_MS
  ) {
    throw clientError(
      "invalid-request",
      `readyTimeoutMs는 1~${STUDIO_VRM_TEXTURE_FILL_WORKER_MAX_READY_TIMEOUT_MS}ms 정수여야 합니다.`,
    );
  }
  return timeout;
}

let fallbackRequestSequence = 0;

function createRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  fallbackRequestSequence =
    fallbackRequestSequence >= Number.MAX_SAFE_INTEGER ? 1 : fallbackRequestSequence + 1;
  return `vrm-fill-${Date.now().toString(36)}-${fallbackRequestSequence.toString(36)}`;
}

/**
 * Keeps only the protocol's clone-safe data fields while deliberately retaining the caller's
 * owned pixel view. The pixel ArrayBuffer is consumed by the first successful postMessage.
 */
function snapshotRequest(
  request: StudioVrmTextureFillRequest,
): StudioVrmTextureFillRequest {
  if (!isStudioVrmTextureFillRequest(request)) {
    throw clientError(
      "invalid-request",
      "3D 표면 채우기 요청은 전용 RGBA8 ArrayBuffer와 유효한 치수·seed·허용치를 사용해야 합니다.",
    );
  }
  return {
    pixels: request.pixels,
    width: request.width,
    height: request.height,
    seed: {
      x: request.seed.x,
      y: request.seed.y,
    },
    tolerance: request.tolerance,
    scope: request.scope,
  };
}

function remoteError(response: StudioVrmTextureFillWorkerFailureMessage): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  if (response.error.code) {
    Object.defineProperty(error, "code", {
      configurable: true,
      enumerable: true,
      value: response.error.code,
    });
  }
  return error;
}

function resultMatchesRequest(
  result: StudioVrmTextureFillResult,
  request: StudioVrmTextureFillRequest,
): boolean {
  const pixelCount = request.width * request.height;
  const expectedMaskBytes = Math.ceil(pixelCount / 8);
  if (
    result.bitMask.byteLength !== expectedMaskBytes ||
    result.matchedCount > pixelCount
  ) {
    return false;
  }
  const validTailBits = pixelCount & 7;
  if (validTailBits !== 0) {
    const lastByte = result.bitMask.at(-1) ?? 0;
    const validTailMask = (1 << validTailBits) - 1;
    if ((lastByte & ~validTailMask) !== 0) return false;
  }
  const bounds = result.bounds;
  return bounds === null ||
    (
      bounds.x < request.width &&
      bounds.y < request.height &&
      bounds.width <= request.width - bounds.x &&
      bounds.height <= request.height - bounds.y
    );
}

function safeCleanup(callback: () => void): void {
  try {
    callback();
  } catch {
    // Cleanup must never replace the already selected terminal result.
  }
}

function runWithWorker(
  worker: StudioVrmTextureFillWorkerLike,
  request: StudioVrmTextureFillRequest,
  readyTimeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<StudioVrmTextureFillWorkerClientResult> {
  const message: StudioVrmTextureFillWorkerRunMessage = {
    type: "studio-vrm-texture-fill/run",
    version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    requestId: createRequestId(),
    request,
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let posted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = (): void => {
      if (readyTimer !== null) {
        globalThis.clearTimeout(readyTimer);
        readyTimer = null;
      }
      signal?.removeEventListener("abort", onAbort);
      safeCleanup(() => {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
      });
      safeCleanup(() => worker.terminate());
    };
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };
    const rejectProtocol = (detail: string): void => {
      finish(() => reject(clientError(
        "worker-protocol",
        `3D 표면 채우기 Worker 응답 계약이 올바르지 않습니다. ${detail}`,
      )));
    };
    const onAbort = (): void => {
      finish(() => reject(abortError()));
    };

    worker.onmessage = (event) => {
      if (settled) return;
      const response = event.data;
      if (!isStudioVrmTextureFillWorkerResponseMessage(response)) {
        rejectProtocol("알 수 없는 메시지를 받았습니다.");
        return;
      }

      if (response.type === "studio-vrm-texture-fill/ready") {
        if (posted) {
          rejectProtocol("ready 메시지가 중복되었습니다.");
          return;
        }
        if (readyTimer !== null) {
          globalThis.clearTimeout(readyTimer);
          readyTimer = null;
        }
        const transfers = studioVrmTextureFillRequestTransfers(message);
        try {
          // Set first so even a synchronous test double cannot return a result before the gate.
          posted = true;
          worker.postMessage(message, transfers);
        } catch (cause) {
          finish(() => reject(clientError(
            "worker-post-failed",
            "3D 표면 채우기 픽셀을 Worker에 전달하지 못했습니다.",
            cause,
          )));
        }
        return;
      }

      if (!posted) {
        rejectProtocol("ready 전에 결과가 도착했습니다.");
        return;
      }
      if (response.requestId !== message.requestId) {
        rejectProtocol("requestId가 현재 요청과 일치하지 않습니다.");
        return;
      }
      if (response.type === "studio-vrm-texture-fill/failure") {
        finish(() => reject(remoteError(response)));
        return;
      }
      if (!resultMatchesRequest(response.result, request)) {
        rejectProtocol("결과 마스크의 치수나 범위가 현재 텍스처와 일치하지 않습니다.");
        return;
      }
      finish(() => resolve({
        execution: "worker",
        result: response.result,
      }));
    };
    worker.onerror = (event) => {
      if (settled) return;
      event.preventDefault?.();
      const fallback = posted
        ? "3D 표면 채우기 Worker 실행 중 오류가 발생했습니다."
        : "3D 표면 채우기 Worker를 준비하지 못했습니다.";
      const detail = event.error instanceof Error
        ? event.error.message
        : event.message;
      finish(() => reject(clientError(
        posted ? "worker-runtime" : "worker-unavailable",
        detail || fallback,
        event.error,
      )));
    };
    worker.onmessageerror = () => {
      rejectProtocol("응답을 구조적으로 복제할 수 없습니다.");
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    readyTimer = globalThis.setTimeout(() => {
      finish(() => reject(clientError(
        "worker-timeout",
        `3D 표면 채우기 Worker가 ${readyTimeoutMs}ms 안에 준비되지 않았습니다.`,
      )));
    }, readyTimeoutMs);
  });
}

/**
 * Runs one 3D baseColor fill in a dedicated Worker. This path intentionally has no direct
 * main-thread fallback: 2K/4K flood fill must fail closed instead of blocking pointer rendering.
 *
 * `request.pixels` must own its complete ArrayBuffer. Once the Worker sends `ready`, that exact
 * buffer is transferred and detached in the caller realm, regardless of the eventual job result.
 */
export async function runStudioVrmTextureFillWorker(
  request: StudioVrmTextureFillRequest,
  options: RunStudioVrmTextureFillWorkerOptions = {},
): Promise<StudioVrmTextureFillWorkerClientResult> {
  if (options.signal?.aborted) throw abortError();
  const safeRequest = snapshotRequest(request);
  const readyTimeoutMs = normalizedReadyTimeoutMs(options.readyTimeoutMs);
  const factory = options.workerFactory === undefined
    ? createStudioVrmTextureFillModuleWorker
    : options.workerFactory;
  if (!factory) {
    throw clientError(
      "worker-unavailable",
      "이 브라우저에서는 3D 표면 채우기 Worker를 사용할 수 없습니다.",
    );
  }

  let worker: StudioVrmTextureFillWorkerLike | null;
  try {
    worker = factory();
  } catch (cause) {
    throw clientError(
      "worker-unavailable",
      "3D 표면 채우기 Worker를 시작하지 못했습니다.",
      cause,
    );
  }
  if (!worker) {
    throw clientError(
      "worker-unavailable",
      "이 브라우저에서는 3D 표면 채우기 Worker를 사용할 수 없습니다.",
    );
  }
  return runWithWorker(worker, safeRequest, readyTimeoutMs, options.signal);
}
