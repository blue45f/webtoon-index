/**
 * OffscreenCanvas 래스터화 Worker 의 메인스레드 클라이언트.
 *
 * 레포 관례(studio-bg3d-shot-png-worker-client / studio-image-filter-worker-client)를 따른다:
 *  - `*WorkerLike` 구조 타입 + 주입 가능한 factory(테스트는 가짜 Worker 를 꽂는다).
 *  - Vite 가 정적으로 발견하는 `new Worker(new URL("./*.worker.ts", import.meta.url))` 한 줄.
 *  - ready / unavailable 핸드셰이크와 유계 타임아웃.
 *
 * 여기서 더 나아간 점:
 *  - 실패를 **throw 하지 않는다**. `run()` 은 항상 `{ ok: true } | { ok: false, code }` 로
 *    resolve 한다 — 호출자가 선택된 provider의 unavailable 상태와 원인을 잃지 않게 한다.
 *  - 코얼레싱·백프레셔·runId 중재는 순수 스케줄러에 위임한다(헤드리스 검증 가능).
 *
 * 핫패스 계약: 이 클라이언트는 React 상태를 전혀 건드리지 않는다. 결과는 Promise 로만 나가고,
 * 호출자는 그것을 커밋 지연 파이프라인/미니 스토어 규율 안에서 소비해야 한다. 제스처 중에
 * 프레임마다 `run()` 을 불러도 코얼레싱 때문에 Worker 왕복은 최대 1건만 비행한다.
 */

import {
  StudioOffscreenRasterScheduler,
  type StudioOffscreenDroppedJob,
  type StudioOffscreenQueuePolicy,
} from "./studio-offscreen-raster-scheduler";
import {
  STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
  isStudioOffscreenRasterResponseMessage,
  isStudioOffscreenRasterRunMessage,
  studioOffscreenRasterRequestTransfers,
  type StudioOffscreenRasterFailureCode,
  type StudioOffscreenRasterOutput,
  type StudioOffscreenRasterResultPayload,
  type StudioOffscreenRasterRunMessage,
  type StudioOffscreenRasterSource,
  type StudioOffscreenRasterTarget,
} from "./studio-offscreen-raster-worker-protocol";

interface MessageEventLike {
  readonly data: unknown;
}

interface ErrorEventLike {
  preventDefault?(): void;
}

export interface StudioOffscreenRasterWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: ErrorEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: ErrorEventLike) => void): void;
  terminate(): void;
}

export type StudioOffscreenRasterWorkerFactory = () => StudioOffscreenRasterWorkerLike | null;

export const STUDIO_OFFSCREEN_RASTER_STARTUP_TIMEOUT_MS = 5_000;
export const STUDIO_OFFSCREEN_RASTER_RUN_TIMEOUT_MS = 30_000;

export interface StudioOffscreenRasterSessionOptions {
  /** 생략하면 Vite 모듈 Worker. `null` 은 선택된 Worker provider를 명시적으로 비활성화한다. */
  readonly workerFactory?: StudioOffscreenRasterWorkerFactory | null;
  readonly policy?: StudioOffscreenQueuePolicy;
  readonly maxQueued?: number;
  readonly startupTimeoutMs?: number;
  readonly runTimeoutMs?: number;
  /** 타이머 주입(테스트 결정성). */
  readonly setTimeoutImpl?: (handler: () => void, ms: number) => unknown;
  readonly clearTimeoutImpl?: (handle: unknown) => void;
}

export interface StudioOffscreenRasterRunInput {
  readonly target: StudioOffscreenRasterTarget;
  readonly sources: readonly StudioOffscreenRasterSource[];
  readonly output: StudioOffscreenRasterOutput;
}

export interface StudioOffscreenRasterRunOptions {
  readonly signal?: AbortSignal;
}

export type StudioOffscreenRasterRunResult =
  | {
      readonly ok: true;
      readonly runId: number;
      readonly width: number;
      readonly height: number;
      readonly payload: StudioOffscreenRasterResultPayload;
    }
  | {
      readonly ok: false;
      readonly runId: number;
      readonly code: StudioOffscreenRasterFailureCode;
      readonly message: string;
    };

export interface StudioOffscreenRasterSession {
  /** Starts the module Worker handshake without allocating or transferring any raster source. */
  warm(): boolean;
  run(
    jobKey: string,
    input: StudioOffscreenRasterRunInput,
    options?: StudioOffscreenRasterRunOptions,
  ): Promise<StudioOffscreenRasterRunResult>;
  dispose(): void;
}

/** Vite 가 이 정확한 URL 패턴을 정적으로 찾아 독립 모듈 Worker 청크를 만든다. */
export function createStudioOffscreenRasterModuleWorker(): StudioOffscreenRasterWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-offscreen-raster.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-offscreen-raster",
  });
}

function failure(
  runId: number,
  code: StudioOffscreenRasterFailureCode,
  message: string,
): StudioOffscreenRasterRunResult {
  return { ok: false, runId, code, message };
}

interface PendingTask {
  /** 스케줄러가 발급한 뒤 채워진다(제출 전에는 0). */
  runId: number;
  message: StudioOffscreenRasterRunMessage | null;
  readonly settle: (result: StudioOffscreenRasterRunResult) => void;
  detachAbort: () => void;
  done: boolean;
}

/**
 * 세션 하나 = Worker 하나 + 직렬 실행 슬롯 하나. 폭주하는 요청은 스케줄러가 jobKey 단위로
 * 접어버리므로, Worker 는 항상 "가장 최근에 유효한" 잡만 본다.
 */
export function createStudioOffscreenRasterSession(
  options: StudioOffscreenRasterSessionOptions = {},
): StudioOffscreenRasterSession {
  const factory = options.workerFactory === undefined
    ? createStudioOffscreenRasterModuleWorker
    : options.workerFactory;
  const scheduler = new StudioOffscreenRasterScheduler<PendingTask>({
    policy: options.policy,
    maxQueued: options.maxQueued,
  });
  const setTimer = options.setTimeoutImpl
    ?? ((handler: () => void, ms: number) => globalThis.setTimeout(handler, ms));
  const clearTimer = options.clearTimeoutImpl
    ?? ((handle: unknown) => { globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>); });
  const startupTimeoutMs = Math.max(100, options.startupTimeoutMs ?? STUDIO_OFFSCREEN_RASTER_STARTUP_TIMEOUT_MS);
  const runTimeoutMs = Math.max(100, options.runTimeoutMs ?? STUDIO_OFFSCREEN_RASTER_RUN_TIMEOUT_MS);

  const tasks = new Map<number, PendingTask>();
  let worker: StudioOffscreenRasterWorkerLike | null = null;
  let ready = false;
  let unavailableCode: StudioOffscreenRasterFailureCode | null = null;
  let startupTimer: unknown = null;
  let runTimer: unknown = null;
  let disposed = false;

  const finish = (task: PendingTask, result: StudioOffscreenRasterRunResult): void => {
    if (task.done) return;
    task.done = true;
    tasks.delete(task.runId);
    task.detachAbort();
    task.settle(result);
  };

  const dropAll = (
    dropped: readonly StudioOffscreenDroppedJob<PendingTask>[],
  ): void => {
    for (const entry of dropped) {
      const task = entry.job.payload;
      const code: StudioOffscreenRasterFailureCode = entry.reason === "coalesced"
        ? "superseded"
        : entry.reason === "backpressure"
          ? "superseded"
          : "cancelled";
      finish(task, failure(
        task.runId,
        code,
        entry.reason === "coalesced"
          ? "더 새로운 래스터 요청이 이 요청을 대체했습니다."
          : entry.reason === "backpressure"
            ? "래스터 대기열이 가득 차 오래된 요청을 버렸습니다."
            : "래스터 요청이 취소되었습니다.",
      ));
    }
  };

  const clearRunTimer = (): void => {
    if (runTimer !== null) clearTimer(runTimer);
    runTimer = null;
  };

  const failEverything = (code: StudioOffscreenRasterFailureCode, message: string): void => {
    clearRunTimer();
    const dropped = scheduler.dispose();
    for (const entry of dropped) finish(entry.job.payload, failure(entry.job.runId, code, message));
    for (const task of Array.from(tasks.values())) finish(task, failure(task.runId, code, message));
  };

  const closeWorker = (): void => {
    if (startupTimer !== null) clearTimer(startupTimer);
    startupTimer = null;
    clearRunTimer();
    if (worker) {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerError);
      worker.removeEventListener("messageerror", onWorkerError);
      worker.terminate();
    }
    worker = null;
    ready = false;
  };

  function postCancel(runId: number): void {
    if (!worker || !ready) return;
    try {
      worker.postMessage(
        { version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION, kind: "cancel", runId },
        [],
      );
    } catch {
      // cancel 은 최선 노력이다 — 중재가 여전히 stale 결과를 막는다.
    }
  }

  function pump(): void {
    if (disposed || !ready || !worker) return;
    if (scheduler.inFlightRunId !== null) return;
    const next = scheduler.takeNext();
    if (!next) return;
    const task = next.payload;
    if (task.done || !task.message) {
      scheduler.settle(next.runId);
      pump();
      return;
    }
    const outbound = task.message;
    try {
      worker.postMessage(outbound, studioOffscreenRasterRequestTransfers(outbound));
      // 전송 완료 = 소유권 이관. 이 메시지의 픽셀 저장소는 메인스레드에서 detach 됐으므로
      // 참조를 놓아 재전송(= detached ArrayBuffer 로 postMessage 실패)을 구조적으로 막는다.
      task.message = null;
    } catch (error) {
      scheduler.settle(next.runId);
      finish(task, failure(
        task.runId,
        "worker-failed",
        error instanceof Error ? error.message : "래스터 요청 전송에 실패했습니다.",
      ));
      pump();
      return;
    }
    runTimer = setTimer(() => {
      runTimer = null;
      const abandoned = scheduler.abandonInFlight();
      closeWorker();
      if (abandoned) {
        scheduler.settle(abandoned.runId);
        finish(abandoned.payload, failure(abandoned.runId, "timeout", "래스터 계산 시간이 초과되었습니다."));
      }
      // 남은 큐는 새 Worker 로 이어간다.
      ensureWorker();
    }, runTimeoutMs);
  }

  function onMessage(event: MessageEventLike): void {
    const response = event.data;
    if (!isStudioOffscreenRasterResponseMessage(response)) {
      closeWorker();
      unavailableCode = "protocol";
      failEverything("protocol", "래스터 Worker가 알 수 없는 응답을 반환했습니다.");
      return;
    }
    if (response.kind === "ready") {
      if (startupTimer !== null) clearTimer(startupTimer);
      startupTimer = null;
      ready = true;
      pump();
      return;
    }
    if (response.kind === "unavailable") {
      closeWorker();
      unavailableCode = "unsupported";
      failEverything("unsupported", "이 브라우저 Worker는 OffscreenCanvas 합성을 지원하지 않습니다.");
      return;
    }
    const verdict = scheduler.settle(response.runId);
    if (verdict.kind !== "accept") {
      // 늦게 도착한 옛 런의 결과 — 절대 커밋하지 않는다. 전송된 픽셀은 여기서 그대로 버려진다.
      // 다만 그 응답이 "취소된 비행 런"의 종료 통지였다면 슬롯이 열렸으니 다음 잡을 진행한다.
      if (scheduler.inFlightRunId === null) {
        clearRunTimer();
        pump();
      }
      return;
    }
    clearRunTimer();
    const task = verdict.job.payload;
    if (response.kind === "failure") {
      finish(task, failure(response.runId, response.code, response.message));
    } else {
      finish(task, {
        ok: true,
        runId: response.runId,
        width: response.width,
        height: response.height,
        payload: response.payload,
      });
    }
    pump();
  }

  function onWorkerError(event: ErrorEventLike): void {
    event.preventDefault?.();
    closeWorker();
    unavailableCode = "worker-failed";
    failEverything("worker-failed", "래스터 Worker 실행 중 오류가 발생했습니다.");
  }

  function ensureWorker(): boolean {
    if (disposed || unavailableCode !== null || !factory) return false;
    if (worker) return true;
    let created: StudioOffscreenRasterWorkerLike | null;
    try {
      created = factory();
    } catch {
      created = null;
    }
    if (!created) {
      unavailableCode = "worker-failed";
      failEverything("worker-failed", "래스터 Worker를 만들 수 없습니다.");
      return false;
    }
    worker = created;
    ready = false;
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerError);
    worker.addEventListener("messageerror", onWorkerError);
    startupTimer = setTimer(() => {
      startupTimer = null;
      closeWorker();
      unavailableCode = "timeout";
      failEverything("timeout", "래스터 Worker가 준비되지 않았습니다.");
    }, startupTimeoutMs);
    return worker !== null;
  }

  return {
    warm() {
      return ensureWorker();
    },
    run(jobKey, input, runOptions = {}) {
      if (disposed) {
        return Promise.resolve(failure(0, "cancelled", "래스터 세션이 종료되었습니다."));
      }
      if (!factory) {
        return Promise.resolve(failure(0, "unsupported", "래스터 Worker가 비활성화되어 있습니다."));
      }
      if (unavailableCode !== null) {
        return Promise.resolve(failure(0, unavailableCode, "래스터 Worker를 사용할 수 없습니다."));
      }

      return new Promise<StudioOffscreenRasterRunResult>((resolve) => {
        // runId 는 스케줄러만 발급하므로 태스크를 먼저 만들고 제출 직후 채운다.
        const task: PendingTask = {
          runId: 0,
          message: null,
          settle: resolve,
          detachAbort: () => {},
          done: false,
        };
        const outcome = scheduler.submit(jobKey, task);
        task.runId = outcome.job.runId;
        task.message = {
          version: STUDIO_OFFSCREEN_RASTER_WORKER_PROTOCOL_VERSION,
          kind: "run",
          runId: outcome.job.runId,
          jobKey,
          target: input.target,
          sources: input.sources,
          output: input.output,
        };
        tasks.set(task.runId, task);

        const onAbort = (): void => {
          if (task.done) return;
          const wasInFlight = scheduler.inFlightRunId === task.runId;
          scheduler.cancel(task.runId);
          if (wasInFlight) {
            scheduler.abandonInFlight();
            clearRunTimer();
            // The Worker protocol has one serial execution slot. Posting the next run immediately
            // after an in-flight abort can reach the same Worker while the abandoned job is still
            // encoding, which the Worker correctly rejects as a concurrent protocol violation.
            // Termination is the only prompt cancellation fence that also makes the transferred
            // source buffers unreachable; resume queued work only after a fresh ready handshake.
            closeWorker();
            scheduler.settle(task.runId);
          } else {
            // A queued task was never posted, so no Worker response will arrive to clear its
            // cancellation tombstone. Settle it locally to keep a long-lived warm session bounded.
            scheduler.settle(task.runId);
          }
          finish(task, failure(task.runId, "cancelled", "래스터 요청이 취소되었습니다."));
          if (wasInFlight) ensureWorker();
          else pump();
        };
        task.detachAbort = () => {
          runOptions.signal?.removeEventListener("abort", onAbort);
        };
        runOptions.signal?.addEventListener("abort", onAbort, { once: true });

        dropAll(outcome.dropped);
        if (outcome.supersededInFlightRunId !== null) {
          // 비행 중이던 같은 키의 런은 여기서 즉시 정산한다. Worker 로는 cancel 을 보내되,
          // 실행 슬롯은 그 런의 응답(result 든 cancelled 든)이 도착할 때 열린다 — Worker 는
          // 직렬이므로 응답 전에 다음 잡을 밀어넣으면 프로토콜 위반이 된다.
          const superseded = tasks.get(outcome.supersededInFlightRunId);
          postCancel(outcome.supersededInFlightRunId);
          if (superseded) {
            finish(superseded, failure(
              superseded.runId,
              "superseded",
              "더 새로운 래스터 요청이 이 요청을 대체했습니다.",
            ));
          }
        }
        if (task.done) return;

        if (!isStudioOffscreenRasterRunMessage(task.message)) {
          scheduler.cancel(task.runId);
          scheduler.settle(task.runId);
          finish(task, failure(task.runId, "protocol", "래스터 요청 형식이 올바르지 않습니다."));
          return;
        }
        if (runOptions.signal?.aborted) {
          onAbort();
          return;
        }
        ensureWorker();
        pump();
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      closeWorker();
      failEverything("cancelled", "래스터 세션이 종료되었습니다.");
    },
  };
}
