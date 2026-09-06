import {
  cloneStudioAutoColorHintsWorkerRequest,
  isStudioAutoColorHintsWorkerFailureMessage,
  isStudioAutoColorHintsWorkerPlan,
  isStudioAutoColorHintsWorkerReadyMessage,
  isStudioAutoColorHintsWorkerSuccessMessage,
  STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
  studioAutoColorHintsRequestTransfers,
  studioAutoColorHintsResponseCorrelation,
  type StudioAutoColorHintsWorkerFailureCode,
  type StudioAutoColorHintsWorkerResponseMessage,
  type StudioAutoColorHintsWorkerRunMessage,
} from "./studio-auto-color-hints-worker-protocol";

import type { StudioAutoColorHintPlan, StudioAutoColorHintRequest } from "./studio-auto-color-hints";

export const STUDIO_AUTO_COLOR_HINTS_WORKER_DEFAULT_TIMEOUT_MS = 15_000;
export const STUDIO_AUTO_COLOR_HINTS_WORKER_MAX_TIMEOUT_MS = 60_000;

export type StudioAutoColorHintsWorkerClientErrorCode =
  | StudioAutoColorHintsWorkerFailureCode
  | "worker-disposed"
  | "worker-unavailable"
  | "worker-post-failed"
  | "worker-protocol"
  | "worker-runtime"
  | "worker-timeout";

export class StudioAutoColorHintsWorkerClientError extends Error {
  readonly code: StudioAutoColorHintsWorkerClientErrorCode;

  constructor(code: StudioAutoColorHintsWorkerClientErrorCode, message: string) {
    super(message);
    this.name = "StudioAutoColorHintsWorkerClientError";
    this.code = code;
  }
}

export interface StudioAutoColorHintsWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioAutoColorHintsWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioAutoColorHintsWorkerFactory = () => StudioAutoColorHintsWorkerLike | null;

export interface StudioAutoColorHintsWorkerClientOptions {
  readonly workerFactory?: StudioAutoColorHintsWorkerFactory | null;
  readonly timeoutMs?: number;
}

export interface StudioAutoColorHintsWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface RunStudioAutoColorHintsWorkerOptions
  extends StudioAutoColorHintsWorkerClientOptions,
    StudioAutoColorHintsWorkerRunOptions {}

interface ActiveJob {
  readonly requestId: number;
  readonly generation: number;
  readonly worker: StudioAutoColorHintsWorkerLike;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (plan: StudioAutoColorHintPlan) => void;
  readonly reject: (error: unknown) => void;
  readonly expected: {
    readonly width: number;
    readonly height: number;
    readonly pixelCount: number;
    readonly requestedHintCount: number;
  };
  timer: ReturnType<typeof setTimeout> | null;
  posted: boolean;
  onAbort: () => void;
}

/** Vite statically discovers this exact URL and emits an isolated module-worker chunk. */
export function createStudioAutoColorHintsModuleWorker(): StudioAutoColorHintsWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-auto-color-hints.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-auto-color-hints",
  }) as unknown as StudioAutoColorHintsWorkerLike;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? STUDIO_AUTO_COLOR_HINTS_WORKER_DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > STUDIO_AUTO_COLOR_HINTS_WORKER_MAX_TIMEOUT_MS) {
    throw new RangeError(
      `timeoutMs must be an integer between 1 and ${STUDIO_AUTO_COLOR_HINTS_WORKER_MAX_TIMEOUT_MS}.`,
    );
  }
  return timeout;
}

function createAbortError(message: string): Error {
  if (typeof DOMException === "function") return new DOMException(message, "AbortError");
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function classifyRequestError(error: unknown): StudioAutoColorHintsWorkerClientError {
  const message = error instanceof Error ? error.message : "자동 채색 힌트 요청이 올바르지 않습니다.";
  const code =
    error instanceof RangeError && /budget|safety limit|exceeds/i.test(message)
      ? "budget-exceeded"
      : "invalid-request";
  return new StudioAutoColorHintsWorkerClientError(code, message);
}

function isMessageType(value: unknown, type: StudioAutoColorHintsWorkerResponseMessage["type"]): boolean {
  return value !== null && typeof value === "object" && Reflect.get(value, "type") === type;
}

function protocolError(message: string): StudioAutoColorHintsWorkerClientError {
  return new StudioAutoColorHintsWorkerClientError("worker-protocol", message);
}

function deserializeFailure(
  response: Extract<StudioAutoColorHintsWorkerResponseMessage, { type: "studio-auto-color-hints/failure" }>,
): StudioAutoColorHintsWorkerClientError {
  const error = new StudioAutoColorHintsWorkerClientError(response.error.code, response.error.message);
  error.name = response.error.name || error.name;
  return error;
}

export class StudioAutoColorHintsWorkerClient {
  readonly #workerFactory: StudioAutoColorHintsWorkerFactory | null;
  readonly #defaultTimeoutMs: number;
  #active: ActiveJob | null = null;
  #disposed = false;
  #lastRequestId = 0;
  #lastGeneration = 0;

  constructor(options: StudioAutoColorHintsWorkerClientOptions = {}) {
    this.#workerFactory =
      options.workerFactory === undefined ? createStudioAutoColorHintsModuleWorker : options.workerFactory;
    this.#defaultTimeoutMs = normalizeTimeout(options.timeoutMs);
  }

  get hasActiveJob(): boolean {
    return this.#active !== null;
  }

  run(
    request: StudioAutoColorHintRequest,
    options: StudioAutoColorHintsWorkerRunOptions = {},
  ): Promise<StudioAutoColorHintPlan> {
    if (this.#disposed) {
      return Promise.reject(
        new StudioAutoColorHintsWorkerClientError(
          "worker-disposed",
          "종료된 자동 채색 힌트 Worker client는 다시 사용할 수 없습니다.",
        ),
      );
    }

    let cloneSafeRequest: StudioAutoColorHintRequest;
    let timeoutMs: number;
    try {
      cloneSafeRequest = cloneStudioAutoColorHintsWorkerRequest(request);
      timeoutMs = normalizeTimeout(options.timeoutMs ?? this.#defaultTimeoutMs);
    } catch (error) {
      return Promise.reject(classifyRequestError(error));
    }
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError("자동 채색 힌트 계산을 취소했습니다."));
    }

    this.#cancelActive(createAbortError("새 자동 채색 힌트 요청으로 이전 계산을 대체했습니다."));
    const requestId = ++this.#lastRequestId;
    const generation = ++this.#lastGeneration;
    if (!Number.isSafeInteger(requestId) || !Number.isSafeInteger(generation)) {
      return Promise.reject(protocolError("자동 채색 힌트 Worker 세대 번호가 안전 범위를 벗어났습니다."));
    }

    if (!this.#workerFactory) {
      return Promise.reject(
        new StudioAutoColorHintsWorkerClientError(
          "worker-unavailable",
          "이 브라우저에서는 자동 채색 힌트 Worker를 사용할 수 없습니다.",
        ),
      );
    }
    let worker: StudioAutoColorHintsWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
      return Promise.reject(
        new StudioAutoColorHintsWorkerClientError(
          "worker-unavailable",
          `자동 채색 힌트 Worker를 시작하지 못했습니다.${detail}`,
        ),
      );
    }
    if (!worker) {
      return Promise.reject(
        new StudioAutoColorHintsWorkerClientError(
          "worker-unavailable",
          "이 브라우저에서는 자동 채색 힌트 Worker를 사용할 수 없습니다.",
        ),
      );
    }

    const message: StudioAutoColorHintsWorkerRunMessage = {
      type: "studio-auto-color-hints/run",
      version: STUDIO_AUTO_COLOR_HINTS_WORKER_PROTOCOL_VERSION,
      requestId,
      generation,
      request: cloneSafeRequest,
    };
    const expected = {
      width: cloneSafeRequest.image.width,
      height: cloneSafeRequest.image.height,
      pixelCount: cloneSafeRequest.image.width * cloneSafeRequest.image.height,
      requestedHintCount: cloneSafeRequest.seeds.length,
    };

    return new Promise<StudioAutoColorHintPlan>((resolve, reject) => {
      const job: ActiveJob = {
        requestId,
        generation,
        worker,
        signal: options.signal,
        resolve,
        reject,
        expected,
        timer: null,
        posted: false,
        onAbort: () => undefined,
      };
      job.onAbort = () => {
        this.#finish(job, () => reject(createAbortError("자동 채색 힌트 계산을 취소했습니다.")));
      };
      this.#active = job;

      worker.onmessage = (event) => this.#handleMessage(job, message, event.data);
      worker.onerror = (event) => {
        event.preventDefault?.();
        const detail =
          event.error instanceof Error && event.error.message
            ? event.error.message
            : event.message || "자동 채색 힌트 Worker 실행 중 오류가 발생했습니다.";
        const code = job.posted ? "worker-runtime" : "worker-unavailable";
        this.#finish(job, () => reject(new StudioAutoColorHintsWorkerClientError(code, detail)));
      };
      worker.onmessageerror = () => {
        this.#finish(job, () => reject(protocolError("자동 채색 힌트 Worker 응답을 복제하지 못했습니다.")));
      };
      options.signal?.addEventListener("abort", job.onAbort, { once: true });
      job.timer = setTimeout(() => {
        const error = new StudioAutoColorHintsWorkerClientError(
          "worker-timeout",
          `자동 채색 힌트 Worker가 ${timeoutMs}ms 안에 응답하지 않았습니다.`,
        );
        error.name = "TimeoutError";
        this.#finish(job, () => reject(error));
      }, timeoutMs);
    });
  }

  cancel(): void {
    this.#cancelActive(createAbortError("자동 채색 힌트 계산을 취소했습니다."));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelActive(createAbortError("자동 채색 힌트 Worker client를 종료했습니다."));
  }

  #handleMessage(
    job: ActiveJob,
    requestMessage: StudioAutoColorHintsWorkerRunMessage,
    response: unknown,
  ): void {
    if (this.#active !== job) return;

    if (isMessageType(response, "studio-auto-color-hints/ready")) {
      if (!isStudioAutoColorHintsWorkerReadyMessage(response) || job.posted) {
        this.#finish(job, () => job.reject(protocolError("자동 채색 힌트 Worker ready 응답이 올바르지 않습니다.")));
        return;
      }
      try {
        job.worker.postMessage(requestMessage, studioAutoColorHintsRequestTransfers(requestMessage));
        job.posted = true;
      } catch (error) {
        const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
        this.#finish(job, () =>
          job.reject(
            new StudioAutoColorHintsWorkerClientError(
              "worker-post-failed",
              `자동 채색 힌트 Worker에 요청을 전달하지 못했습니다.${detail}`,
            ),
          ),
        );
      }
      return;
    }

    const correlation = studioAutoColorHintsResponseCorrelation(response);
    if (
      correlation &&
      (correlation.requestId !== job.requestId || correlation.generation !== job.generation)
    ) {
      return;
    }
    if (!job.posted) {
      this.#finish(job, () => job.reject(protocolError("Worker가 ready 전에 결과를 반환했습니다.")));
      return;
    }
    if (!correlation) {
      this.#finish(job, () => job.reject(protocolError("Worker 응답에 요청·세대 식별자가 없습니다.")));
      return;
    }

    if (isStudioAutoColorHintsWorkerFailureMessage(response)) {
      this.#finish(job, () => job.reject(deserializeFailure(response)));
      return;
    }
    if (isStudioAutoColorHintsWorkerSuccessMessage(response)) {
      if (!isStudioAutoColorHintsWorkerPlan(response.plan, job.expected)) {
        this.#finish(job, () => job.reject(protocolError("Worker가 일치하지 않는 batch plan을 반환했습니다.")));
        return;
      }
      this.#finish(job, () => job.resolve(response.plan));
      return;
    }
    this.#finish(job, () => job.reject(protocolError("자동 채색 힌트 Worker 응답 프로토콜이 올바르지 않습니다.")));
  }

  #cancelActive(error: Error): void {
    const active = this.#active;
    if (!active) return;
    this.#finish(active, () => active.reject(error));
  }

  #finish(job: ActiveJob, settle: () => void): void {
    if (this.#active !== job) return;
    this.#active = null;
    if (job.timer !== null) clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.onAbort);
    job.worker.onmessage = null;
    job.worker.onerror = null;
    job.worker.onmessageerror = null;
    try {
      job.worker.terminate();
    } catch {
      // A broken terminate implementation must not prevent the promise from settling.
    }
    settle();
  }
}

/** One-shot convenience API. Worker absence is an explicit error; no main-thread fallback runs. */
export async function runStudioAutoColorHintsWorker(
  request: StudioAutoColorHintRequest,
  options: RunStudioAutoColorHintsWorkerOptions = {},
): Promise<StudioAutoColorHintPlan> {
  const client = new StudioAutoColorHintsWorkerClient({
    workerFactory: options.workerFactory,
    timeoutMs: options.timeoutMs,
  });
  try {
    return await client.run(request, { signal: options.signal, timeoutMs: options.timeoutMs });
  } finally {
    client.dispose();
  }
}
