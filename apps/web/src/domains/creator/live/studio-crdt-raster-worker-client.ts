import { parseStudioCrdtRasterDocumentRoots } from "../../../shared/lib/studio-crdt-raster-document-contract";

import {
  STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION,
  type StudioCrdtRasterWorkerResponseMessage,
  type StudioCrdtRasterWorkerRunMessage,
} from "./studio-crdt-raster-worker-protocol";

import type {
  StudioCrdtRasterDocumentSnapshot,
  StudioCrdtRasterRawRoots,
} from "../../../shared/lib/studio-crdt-raster-document-contract";

export interface StudioCrdtRasterWorkerLike {
  onmessage: ((event: MessageEvent<StudioCrdtRasterWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioCrdtRasterWorkerRunMessage): void;
  terminate(): void;
}

export type StudioCrdtRasterWorkerFactory = () => StudioCrdtRasterWorkerLike | null;
export type StudioCrdtRasterExecutionMode = "worker" | "direct";

export interface StudioCrdtRasterWorkerClientOptions {
  signal?: AbortSignal;
  /** Execution authority is selected before the operation starts and never changes afterward. */
  executionMode?: StudioCrdtRasterExecutionMode;
  /** Test/integration seam for Worker mode. `null` means unavailable, not direct execution. */
  workerFactory?: StudioCrdtRasterWorkerFactory | null;
}

export interface StudioCrdtRasterWorkerClientResult {
  execution: "worker" | "direct";
  snapshot: StudioCrdtRasterDocumentSnapshot;
}

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioCrdtRasterModuleWorker(): StudioCrdtRasterWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-crdt-raster.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-crdt-raster",
  }) as unknown as StudioCrdtRasterWorkerLike;
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("래스터 문서 파싱을 취소했습니다.", "AbortError");
  }
  const error = new Error("래스터 문서 파싱을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

function createWorkerUnavailableError(message: string, cause?: unknown): Error {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.name = "StudioCrdtRasterWorkerUnavailableError";
  return error;
}

function runCrdtRasterDirect(
  roots: StudioCrdtRasterRawRoots,
  signal: AbortSignal | undefined,
): StudioCrdtRasterWorkerClientResult {
  throwIfAborted(signal);
  return { execution: "direct", snapshot: parseStudioCrdtRasterDocumentRoots(roots) };
}

function deserializeWorkerError(response: Extract<
  StudioCrdtRasterWorkerResponseMessage,
  { type: "studio-crdt-raster/failure" }
>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runCrdtRasterWithWorker(
  worker: StudioCrdtRasterWorkerLike,
  roots: StudioCrdtRasterRawRoots,
  signal: AbortSignal | undefined,
): Promise<StudioCrdtRasterWorkerClientResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioCrdtRasterWorkerRunMessage = {
      type: "studio-crdt-raster/run",
      version: STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION,
      roots,
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
      if (response.version !== STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION) {
        finish(() => reject(new Error("래스터 문서 파싱 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-crdt-raster/ready") {
        if (requestPosted) return;
        if (readyTimer !== null) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        try {
          worker.postMessage(message);
          requestPosted = true;
        } catch (error) {
          rejectWorkerUnavailable("래스터 문서 파싱 Worker에 요청을 전달하지 못했습니다.", error);
        }
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("래스터 문서 파싱 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-crdt-raster/failure") {
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      finish(() => resolve({ execution: "worker", snapshot: response.snapshot }));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (!requestPosted) {
        rejectWorkerUnavailable(
          "래스터 문서 파싱 Worker가 준비되기 전에 사용할 수 없게 되었습니다.",
          event.error ?? event.message,
        );
        return;
      }
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "래스터 문서 파싱 Worker 실행 중 오류가 발생했습니다.");
      finish(() => reject(error));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    readyTimer = setTimeout(
      () => rejectWorkerUnavailable("래스터 문서 파싱 Worker 준비 시간이 초과되었습니다."),
      3_000,
    );
  });
}

/**
 * 래스터 operation-log 파싱·검증(JSON.parse + canonical 재직렬화 비교, exact-schema 검증, 전역
 * patch 수 상한 검증)을 한 번의 모듈 Worker 호출로 실행한다. 입력(roots)·출력(snapshot) 모두
 * 구조적 복제만으로 충분한 순수 JSON/Map 이라 transferable은 쓰지 않는다 — SVG 내보내기 Worker와
 * 동일한 관례. 선택한 Worker를 사용할 수 없거나 실행이 실패하면 같은 요청을 메인 스레드에서
 * 다시 실행하지 않고 unavailable/reject로 종료한다.
 */
export async function runStudioCrdtRasterWorker(
  roots: StudioCrdtRasterRawRoots,
  options: StudioCrdtRasterWorkerClientOptions = {},
): Promise<StudioCrdtRasterWorkerClientResult> {
  throwIfAborted(options.signal);
  const executionMode = options.executionMode ?? "worker";
  if (executionMode === "direct") return runCrdtRasterDirect(roots, options.signal);
  const factory =
    options.workerFactory === undefined ? createStudioCrdtRasterModuleWorker : options.workerFactory;
  if (!factory) throw createWorkerUnavailableError("래스터 문서 파싱 Worker를 만들 수 없습니다.");

  let worker: StudioCrdtRasterWorkerLike | null;
  try {
    worker = factory();
  } catch (error) {
    throw createWorkerUnavailableError("래스터 문서 파싱 Worker를 만들 수 없습니다.", error);
  }
  if (!worker) throw createWorkerUnavailableError("래스터 문서 파싱 Worker를 만들 수 없습니다.");
  return runCrdtRasterWithWorker(worker, roots, options.signal);
}
