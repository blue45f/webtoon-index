import { smoothStrokePoints } from "../studio-brush";

import {
  planStudioStrokePostprocess,
  type StudioStrokePostprocessPlan,
  type StudioStrokePostprocessPlanReason,
} from "./studio-stroke-postprocess-worker-planner";
import {
  STUDIO_STROKE_POSTPROCESS_MAX_ABSOLUTE_COORDINATE,
  STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
  isStudioStrokePostprocessWorkerResponseForAuthority,
  studioStrokePostprocessWorkerRequestTransfers,
  studioStrokePostprocessWorkerResponseIdentity,
  type StudioStrokePostprocessWorkerAuthority,
  type StudioStrokePostprocessWorkerFailureCode,
  type StudioStrokePostprocessWorkerResponseMessage,
  type StudioStrokePostprocessWorkerRunMessage,
} from "./studio-stroke-postprocess-worker-protocol";

import type { SmoothStrokeOptions } from "../studio-brush";

export const STUDIO_STROKE_POSTPROCESS_WORKER_DEFAULT_TIMEOUT_MS = 1_500;
export const STUDIO_STROKE_POSTPROCESS_WORKER_MAX_TIMEOUT_MS = 5_000;

export type StudioStrokePostprocessWorkerClientErrorCode =
  | StudioStrokePostprocessWorkerFailureCode
  | "aborted"
  | "disposed"
  | "invalid-input"
  | "post-failed"
  | "protocol"
  | "timeout"
  | "worker-unavailable"
  | "worker-failed";

export class StudioStrokePostprocessWorkerClientError extends Error {
  constructor(
    readonly code: StudioStrokePostprocessWorkerClientErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : "StudioStrokePostprocessWorkerClientError";
  }
}

export interface StudioStrokePostprocessWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: Readonly<{
    error?: unknown;
    message?: string;
    preventDefault?(): void;
  }>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioStrokePostprocessWorkerRunMessage, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioStrokePostprocessWorkerFactory = () => StudioStrokePostprocessWorkerLike | null;

export interface StudioStrokePostprocessWorkerClientOptions {
  readonly workerFactory?: StudioStrokePostprocessWorkerFactory | null;
  readonly timeoutMs?: number;
}

export interface StudioStrokePostprocessRunOptions extends SmoothStrokeOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface StudioStrokePostprocessResult {
  readonly points: number[];
  readonly execution: "direct" | "worker";
  readonly fallbackReason: Exclude<StudioStrokePostprocessPlanReason, "worker-worthy"> | null;
  readonly requestId: number | null;
  readonly generationId: number | null;
  readonly pointCount: number;
  readonly coordinateByteLength: number;
}

interface ActiveJob {
  readonly authority: StudioStrokePostprocessWorkerAuthority;
  readonly worker: StudioStrokePostprocessWorkerLike;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (result: StudioStrokePostprocessResult) => void;
  readonly reject: (error: StudioStrokePostprocessWorkerClientError) => void;
  readonly onAbort: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  settled: boolean;
}

/** Vite statically discovers this URL and emits a dedicated module-worker chunk. */
export function createStudioStrokePostprocessModuleWorker(): StudioStrokePostprocessWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-stroke-postprocess-worker-entry.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-stroke-postprocess",
  }) as unknown as StudioStrokePostprocessWorkerLike;
}

function normalizeTimeout(value: number | undefined): number {
  const timeoutMs = value ?? STUDIO_STROKE_POSTPROCESS_WORKER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < 1
    || timeoutMs > STUDIO_STROKE_POSTPROCESS_WORKER_MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeoutMs must be an integer between 1 and ${STUDIO_STROKE_POSTPROCESS_WORKER_MAX_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

function createClientError(
  code: StudioStrokePostprocessWorkerClientErrorCode,
  message?: string,
  cause?: unknown,
): StudioStrokePostprocessWorkerClientError {
  return new StudioStrokePostprocessWorkerClientError(
    code,
    message ?? code,
    cause === undefined ? undefined : { cause },
  );
}

function createAbortError(message: string): StudioStrokePostprocessWorkerClientError {
  return createClientError("aborted", message);
}

function normalizedCornerThreshold(value: number | undefined): number {
  if (!Number.isFinite(value)) return 55;
  return Math.min(160, Math.max(20, value as number));
}

function validateCoordinates(points: readonly number[]): void {
  for (let index = 0; index < points.length; index += 1) {
    const coordinate = points[index];
    if (
      coordinate === undefined
      || !Number.isFinite(coordinate)
      || Math.abs(coordinate) > STUDIO_STROKE_POSTPROCESS_MAX_ABSOLUTE_COORDINATE
    ) {
      throw createClientError("invalid-input", `points[${index}] must be a bounded finite coordinate.`);
    }
  }
}

function directResult(
  points: readonly number[],
  plan: StudioStrokePostprocessPlan,
  options: StudioStrokePostprocessRunOptions,
  fallbackReason: Exclude<StudioStrokePostprocessPlanReason, "worker-worthy">,
): StudioStrokePostprocessResult {
  const snapshot = Array.from(points);
  const smoothed = smoothStrokePoints(snapshot, plan.normalizedStrength, {
    preserveCorners: options.preserveCorners === true,
    cornerThresholdDeg: normalizedCornerThreshold(options.cornerThresholdDeg),
  });
  return {
    points: smoothed === snapshot ? snapshot : smoothed,
    execution: "direct",
    fallbackReason,
    requestId: null,
    generationId: null,
    pointCount: plan.pointCount,
    coordinateByteLength: plan.coordinateByteLength,
  };
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Cleanup must not change ownership or prevent promise settlement.
  }
}

/**
 * Concurrent-safe one-shot Worker client. Every admitted long stroke owns a fresh Worker; success,
 * abort, timeout, protocol failure, or crash always terminates it before the promise settles.
 */
export class StudioStrokePostprocessWorkerClient {
  readonly #workerFactory: StudioStrokePostprocessWorkerFactory | null;
  readonly #workerAvailableHint: boolean;
  readonly #defaultTimeoutMs: number;
  readonly #activeJobs = new Set<ActiveJob>();
  #disposed = false;
  #nextRequestId = 1;
  #nextGenerationId = 1;

  constructor(options: StudioStrokePostprocessWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory === undefined
      ? createStudioStrokePostprocessModuleWorker
      : options.workerFactory;
    this.#workerAvailableHint = options.workerFactory === undefined
      ? typeof Worker === "function"
      : options.workerFactory !== null;
    this.#defaultTimeoutMs = normalizeTimeout(options.timeoutMs);
  }

  get activeCount(): number {
    return this.#activeJobs.size;
  }

  postprocess(
    points: readonly number[],
    strength: number,
    options: StudioStrokePostprocessRunOptions = {},
  ): Promise<StudioStrokePostprocessResult> {
    if (this.#disposed) return Promise.reject(createClientError("disposed"));
    if (options.signal?.aborted) {
      return Promise.reject(createAbortError("획 후보정을 시작하기 전에 취소했습니다."));
    }

    let timeoutMs: number;
    try {
      timeoutMs = normalizeTimeout(options.timeoutMs ?? this.#defaultTimeoutMs);
    } catch (error) {
      return Promise.reject(createClientError("invalid-input", "Worker timeout 설정이 올바르지 않습니다.", error));
    }

    const plan = planStudioStrokePostprocess({
      coordinateCount: points.length,
      strength,
      workerAvailable: this.#workerAvailableHint,
    });
    if (plan.kind === "reject") {
      const code = plan.reason === "invalid-coordinate-count" ? "invalid-input" : "budget-exceeded";
      return Promise.reject(createClientError(code, `획 후보정 계획이 거부되었습니다: ${plan.reason}`));
    }
    try {
      validateCoordinates(points);
    } catch (error) {
      return Promise.reject(error);
    }
    if (plan.kind === "direct") {
      if (plan.reason === "worker-worthy") {
        return Promise.reject(createClientError("protocol", "Direct 획 후보정 계획의 이유가 올바르지 않습니다."));
      }
      if (plan.reason === "worker-unavailable") {
        return Promise.reject(createClientError(
          "worker-unavailable",
          "획 후보정 Worker를 사용할 수 없어 원본 획을 유지합니다.",
        ));
      }
      return Promise.resolve(directResult(points, plan, options, plan.reason));
    }

    let worker: StudioStrokePostprocessWorkerLike | null;
    try {
      worker = this.#workerFactory?.() ?? null;
    } catch (error) {
      return Promise.reject(createClientError(
        "worker-unavailable",
        "획 후보정 Worker를 만들지 못해 원본 획을 유지합니다.",
        error,
      ));
    }
    if (!worker) {
      return Promise.reject(createClientError(
        "worker-unavailable",
        "획 후보정 Worker를 사용할 수 없어 원본 획을 유지합니다.",
      ));
    }

    const requestId = this.#allocateRequestId();
    const generationId = this.#allocateGenerationId();
    const transferredPoints = Float64Array.from(points);
    const request: StudioStrokePostprocessWorkerRunMessage = {
      type: "studio-stroke-postprocess/run",
      version: STUDIO_STROKE_POSTPROCESS_WORKER_PROTOCOL_VERSION,
      requestId,
      generationId,
      pointCount: plan.pointCount,
      coordinateByteLength: plan.coordinateByteLength,
      points: transferredPoints,
      strength: plan.normalizedStrength,
      options: {
        preserveCorners: options.preserveCorners === true,
        cornerThresholdDeg: normalizedCornerThreshold(options.cornerThresholdDeg),
      },
    };
    const authority: StudioStrokePostprocessWorkerAuthority = {
      requestId,
      generationId,
      pointCount: plan.pointCount,
      coordinateByteLength: plan.coordinateByteLength,
    };

    return new Promise((resolve, reject) => {
      const job: ActiveJob = {
        authority,
        worker,
        signal: options.signal,
        resolve,
        reject,
        onAbort: () => this.#finish(
          job,
          createAbortError("진행 중인 획 후보정을 취소했습니다."),
        ),
        timer: null,
        settled: false,
      };
      this.#activeJobs.add(job);
      options.signal?.addEventListener("abort", job.onAbort, { once: true });
      worker.onmessage = (event) => this.#handleMessage(job, event.data);
      worker.onerror = (event) => {
        event.preventDefault?.();
        const detail = event.error instanceof Error && event.error.message
          ? event.error.message
          : event.message || "획 후보정 Worker가 비정상 종료되었습니다.";
        this.#finish(job, createClientError("worker-failed", detail, event.error));
      };
      worker.onmessageerror = () => {
        this.#finish(job, createClientError("protocol", "Worker 응답을 구조 복제하지 못했습니다."));
      };
      job.timer = setTimeout(() => {
        this.#finish(
          job,
          createClientError("timeout", `획 후보정 Worker가 ${timeoutMs}ms 안에 응답하지 않았습니다.`),
        );
      }, timeoutMs);

      if (options.signal?.aborted) {
        this.#finish(job, createAbortError("획 후보정 요청이 전달되기 전에 취소되었습니다."));
        return;
      }
      try {
        worker.postMessage(request, studioStrokePostprocessWorkerRequestTransfers(request));
      } catch (error) {
        this.#finish(job, createClientError("post-failed", "Worker에 획 후보정 요청을 전달하지 못했습니다.", error));
      }
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const job of [...this.#activeJobs]) {
      this.#finish(job, createClientError("disposed", "획 후보정 Worker client를 종료했습니다."));
    }
  }

  #allocateRequestId(): number {
    const value = this.#nextRequestId;
    this.#nextRequestId = value >= Number.MAX_SAFE_INTEGER ? 1 : value + 1;
    return value;
  }

  #allocateGenerationId(): number {
    const value = this.#nextGenerationId;
    this.#nextGenerationId = value >= Number.MAX_SAFE_INTEGER ? 1 : value + 1;
    return value;
  }

  #handleMessage(job: ActiveJob, response: unknown): void {
    if (!this.#activeJobs.has(job) || job.settled) return;
    const identity = studioStrokePostprocessWorkerResponseIdentity(response);
    if (
      identity
      && (
        identity.requestId !== job.authority.requestId
        || identity.generationId !== job.authority.generationId
      )
    ) {
      return;
    }
    if (!identity || !isStudioStrokePostprocessWorkerResponseForAuthority(response, job.authority)) {
      this.#finish(job, createClientError("protocol", "Worker 응답이 현재 요청 권한과 일치하지 않습니다."));
      return;
    }
    const accepted = response as StudioStrokePostprocessWorkerResponseMessage;
    if (accepted.type === "studio-stroke-postprocess/failure") {
      this.#finish(
        job,
        createClientError(accepted.error.code, accepted.error.message),
      );
      return;
    }
    this.#finish(job, {
      points: Array.from(accepted.points),
      execution: "worker",
      fallbackReason: null,
      requestId: accepted.requestId,
      generationId: accepted.generationId,
      pointCount: accepted.pointCount,
      coordinateByteLength: accepted.coordinateByteLength,
    });
  }

  #finish(
    job: ActiveJob,
    outcome: StudioStrokePostprocessResult | StudioStrokePostprocessWorkerClientError,
  ): void {
    if (job.settled || !this.#activeJobs.has(job)) return;
    job.settled = true;
    this.#activeJobs.delete(job);
    if (job.timer !== null) clearTimeout(job.timer);
    job.signal?.removeEventListener("abort", job.onAbort);
    job.worker.onmessage = null;
    job.worker.onerror = null;
    job.worker.onmessageerror = null;
    safely(() => job.worker.terminate());
    if (outcome instanceof StudioStrokePostprocessWorkerClientError) job.reject(outcome);
    else job.resolve(outcome);
  }
}

export interface PostprocessStudioStrokePointsOptions
  extends StudioStrokePostprocessWorkerClientOptions,
    StudioStrokePostprocessRunOptions {}

/** One-shot integration helper. The result records the Worker or direct backend selected up front. */
export async function postprocessStudioStrokePoints(
  points: readonly number[],
  strength: number,
  options: PostprocessStudioStrokePointsOptions = {},
): Promise<StudioStrokePostprocessResult> {
  const client = new StudioStrokePostprocessWorkerClient({
    workerFactory: options.workerFactory,
    timeoutMs: options.timeoutMs,
  });
  try {
    return await client.postprocess(points, strength, options);
  } finally {
    client.dispose();
  }
}
