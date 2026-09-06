import { scanMagicWandRegionFromImageData, type MagicWandRegion } from "./studio-magic-wand";
import {
  STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION,
  studioMagicWandRequestTransfers,
  type StudioMagicWandWorkerResponseMessage,
  type StudioMagicWandWorkerRunMessage,
  type StudioMagicWandWorkerRunRequest,
} from "./studio-magic-wand-worker-protocol";

export interface StudioMagicWandWorkerLike {
  onmessage: ((event: MessageEvent<StudioMagicWandWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioMagicWandWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioMagicWandWorkerFactory = () => StudioMagicWandWorkerLike | null;
export type StudioMagicWandExecutionMode = "worker" | "direct";

export interface StudioMagicWandWorkerClientOptions {
  signal?: AbortSignal;
  /** Execution authority is selected before the operation starts and never changes afterward. */
  executionMode?: StudioMagicWandExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  workerFactory?: StudioMagicWandWorkerFactory | null;
}

export interface StudioMagicWandWorkerClientResult {
  execution: "worker" | "direct";
  region: MagicWandRegion;
}

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioMagicWandModuleWorker(): StudioMagicWandWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-magic-wand.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-magic-wand",
  }) as unknown as StudioMagicWandWorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("마술봉 선택 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("마술봉 선택 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "StudioMagicWandWorkerUnavailableError";
  return error;
}

function runMagicWandDirect(
  request: StudioMagicWandWorkerRunRequest,
  signal: AbortSignal | undefined,
): StudioMagicWandWorkerClientResult {
  throwIfAborted(signal);
  const region = scanMagicWandRegionFromImageData(
    request.data,
    request.w,
    request.h,
    request.startX,
    request.startY,
    request.tolerance,
  );
  return { execution: "direct", region };
}

function deserializeWorkerError(response: Extract<
  StudioMagicWandWorkerResponseMessage,
  { type: "studio-magic-wand/failure" }
>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runMagicWandWithWorker(
  worker: StudioMagicWandWorkerLike,
  request: StudioMagicWandWorkerRunRequest,
  signal: AbortSignal | undefined,
): Promise<StudioMagicWandWorkerClientResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioMagicWandWorkerRunMessage = {
      type: "studio-magic-wand/run",
      version: STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION,
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
    const rejectWorkerUnavailable = (message: string, cause?: unknown) => finish(() => reject(
      createWorkerUnavailableError(message, cause),
    ));

    worker.onmessage = (event) => {
      const response = event.data;
      if (response.version !== STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION) {
        finish(() => reject(new Error("마술봉 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-magic-wand/ready") {
        if (requestPosted) return;
        if (readyTimer !== null) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        try {
          worker.postMessage(message, studioMagicWandRequestTransfers(message));
          requestPosted = true;
        } catch (error) {
          rejectWorkerUnavailable("마술봉 Worker에 요청을 전달하지 못했습니다.", error);
        }
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("마술봉 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-magic-wand/failure") {
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      finish(() => resolve({ execution: "worker", region: response.region }));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (!requestPosted) {
        rejectWorkerUnavailable(
          "마술봉 Worker가 준비되기 전에 사용할 수 없게 되었습니다.",
          event.error ?? event.message,
        );
        return;
      }
      // 픽셀 버퍼가 이미 전송(detach)돼 직접 실행으로 되돌릴 데이터가 없다.
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "마술봉 Worker 실행 중 오류가 발생했습니다.");
      finish(() => reject(error));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    readyTimer = setTimeout(
      () => rejectWorkerUnavailable("마술봉 Worker 준비 시간이 초과되었습니다."),
      3_000,
    );
  });
}

/**
 * 마술봉의 플러드필+윤곽 추적을 한 번의 모듈 Worker 호출로 실행한다. ArrayBuffer 기반 픽셀
 * 데이터는 소유권이 이전(detach)되어 전송된다. 선택한 Worker를 사용할 수 없거나 실행이 실패하면
 * 같은 요청을 메인 스레드에서 다시 실행하지 않고 unavailable/reject로 종료한다.
 */
export async function runStudioMagicWandWorker(
  request: StudioMagicWandWorkerRunRequest,
  options: StudioMagicWandWorkerClientOptions = {},
): Promise<StudioMagicWandWorkerClientResult> {
  throwIfAborted(options.signal);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") return runMagicWandDirect(request, options.signal);
  const factory =
    options.workerFactory === undefined ? createStudioMagicWandModuleWorker : options.workerFactory;
  if (!factory) throw createWorkerUnavailableError("마술봉 Worker를 만들 수 없습니다.");

  let worker: StudioMagicWandWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("마술봉 Worker를 만들 수 없습니다.", error);
  }
  if (!worker) throw createWorkerUnavailableError("마술봉 Worker를 만들 수 없습니다.");
  return runMagicWandWithWorker(worker, request, options.signal);
}
