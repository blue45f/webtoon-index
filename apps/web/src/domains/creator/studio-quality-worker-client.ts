import {
  STUDIO_QUALITY_WORKER_BUDGETS,
  STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
  isStudioQualityWorkerResponseForAuthority,
  isStudioQualityWorkerResponseMessage,
  studioQualityWorkerResponseIdentity,
  validateStudioQualityWorkerInboundMessage,
  type StudioQualityWorkerCancelMessage,
  type StudioQualityWorkerInboundMessage,
  type StudioQualityWorkerOperation,
  type StudioQualityWorkerOperationKind,
  type StudioQualityWorkerReadyMessage,
  type StudioQualityWorkerRequestAuthority,
  type StudioQualityWorkerRequestFailureCode,
  type StudioQualityWorkerRequestMessage,
} from "./studio-quality-worker-protocol";

import type {
  StudioPathOpsResult,
  StudioQualityPathOp,
  StudioStrokeToPathStyle,
} from "./render/studio-canvaskit-adapter";

export const STUDIO_QUALITY_WORKER_DEFAULT_INIT_TIMEOUT_MS = 15_000;
export const STUDIO_QUALITY_WORKER_DEFAULT_RUN_TIMEOUT_MS = 30_000;
export const STUDIO_QUALITY_WORKER_MAX_TIMEOUT_MS = 120_000;

let nextDefaultEpoch = Math.min(
  Number.MAX_SAFE_INTEGER - 1_000_000,
  Date.now() * 1_024,
);

export type StudioQualityWorkerClientErrorCode =
  | StudioQualityWorkerRequestFailureCode
  | "aborted"
  | "disposed"
  | "epoch-mismatch"
  | "invalid-input"
  | "invalid-message"
  | "post-failed"
  | "provider-capability-missing"
  | "provider-init-failed"
  | "protocol"
  | "timeout"
  | "unsupported-protocol"
  | "worker-failed"
  | "worker-unavailable";

export class StudioQualityWorkerClientError extends Error {
  constructor(
    readonly code: StudioQualityWorkerClientErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : "StudioQualityWorkerClientError";
  }
}

export interface StudioQualityWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror:
    | ((event: Readonly<{
        error?: unknown;
        message?: string;
        preventDefault?(): void;
      }>) => void)
    | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioQualityWorkerInboundMessage): void;
  terminate(): void;
}

export type StudioQualityWorkerFactory = () => StudioQualityWorkerLike | null;

export interface StudioQualityWorkerClientOptions {
  readonly workerFactory?: StudioQualityWorkerFactory | null;
  readonly workerEpoch?: number;
  readonly clientBuild?: string;
  readonly initTimeoutMs?: number;
  readonly runTimeoutMs?: number;
}

export interface StudioQualityWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface StudioQualityWorkerClientResult {
  readonly execution: "quality-worker";
  readonly providerId: "canvaskit";
  readonly workerEpoch: number;
  readonly requestId: number;
  readonly requestToken: string;
  readonly operationKind: StudioQualityWorkerOperationKind;
  readonly result: StudioPathOpsResult;
}

interface PendingRequest {
  readonly request: StudioQualityWorkerRequestMessage;
  readonly authority: StudioQualityWorkerRequestAuthority;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: StudioQualityWorkerClientResult) => void;
  readonly reject: (error: StudioQualityWorkerClientError) => void;
  readonly onAbort: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  posted: boolean;
  settled: boolean;
}

/** Vite emits CanvasKit and its WASM glue only in this lazily created module Worker graph. */
export function createStudioQualityModuleWorker(): StudioQualityWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-quality-worker-entry.ts", import.meta.url),
    {
      type: "module",
      name: "toonspectrum-quality-geometry",
    },
  ) as unknown as StudioQualityWorkerLike;
}

function allocateDefaultEpoch(): number {
  const epoch = nextDefaultEpoch;
  nextDefaultEpoch = epoch >= Number.MAX_SAFE_INTEGER ? 1 : epoch + 1;
  return epoch;
}

function normalizeTimeout(
  value: number | undefined,
  fallback: number,
): number {
  const timeout = value ?? fallback;
  if (
    !Number.isInteger(timeout)
    || timeout < 1
    || timeout > STUDIO_QUALITY_WORKER_MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      `timeout must be an integer between 1 and ${STUDIO_QUALITY_WORKER_MAX_TIMEOUT_MS}.`,
    );
  }
  return timeout;
}

function clientError(
  code: StudioQualityWorkerClientErrorCode,
  message?: string,
  cause?: unknown,
): StudioQualityWorkerClientError {
  return new StudioQualityWorkerClientError(
    code,
    message ?? code,
    cause === undefined ? undefined : { cause },
  );
}

function abortError(message: string): StudioQualityWorkerClientError {
  return clientError("aborted", message);
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Cleanup must never change promise settlement.
  }
}

function operationToken(
  workerEpoch: number,
  requestId: number,
  kind: StudioQualityWorkerOperationKind,
): string {
  return `q:${workerEpoch}:${requestId}:${kind}`;
}

function snapshotOperation(
  operation: StudioQualityWorkerOperation,
): StudioQualityWorkerOperation {
  if (operation.kind === "path-boolean") {
    return {
      kind: "path-boolean",
      a: operation.a,
      b: operation.b,
      op: operation.op,
    };
  }
  return {
    kind: "stroke-to-fill",
    pathData: operation.pathData,
    style: {
      widthPx: operation.style.widthPx,
      cap: operation.style.cap,
      join: operation.style.join,
      miterLimit: operation.style.miterLimit,
      ...(operation.style.dash
        ? {
            dash: {
              pattern: Array.from(operation.style.dash.pattern),
              phase: operation.style.dash.phase,
            },
          }
        : {}),
    },
  };
}

function assertEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("workerEpoch must be a positive safe integer.");
  }
}

function assertClientBuild(value: string): void {
  if (
    value.trim().length === 0
    || value.length > STUDIO_QUALITY_WORKER_BUDGETS.maxBuildIdentifierCharacters
  ) {
    throw new RangeError("clientBuild is empty or exceeds the protocol budget.");
  }
}

/**
 * Persistent quality Worker client. It keeps one CanvasKit provider warm for one immutable epoch,
 * while every operation remains independently cancellable and exactly correlated.
 */
export class StudioQualityWorkerClient {
  readonly #workerFactory: StudioQualityWorkerFactory | null;
  readonly #workerEpoch: number;
  readonly #clientBuild: string;
  readonly #initTimeoutMs: number;
  readonly #runTimeoutMs: number;
  readonly #pending = new Map<number, PendingRequest>();
  #worker: StudioQualityWorkerLike | null = null;
  #ready: StudioQualityWorkerReadyMessage | null = null;
  #readyPromise: Promise<StudioQualityWorkerReadyMessage> | null = null;
  #resolveReady: ((value: StudioQualityWorkerReadyMessage) => void) | null = null;
  #rejectReady: ((error: StudioQualityWorkerClientError) => void) | null = null;
  #initTimer: ReturnType<typeof setTimeout> | null = null;
  #disposed = false;
  #terminal = false;
  #nextRequestId = 1;
  #settledThroughRequestId = 0;

  constructor(options: StudioQualityWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory === undefined
      ? createStudioQualityModuleWorker
      : options.workerFactory;
    this.#workerEpoch = options.workerEpoch ?? allocateDefaultEpoch();
    this.#clientBuild = options.clientBuild ?? "toonspectrum-studio-quality";
    assertEpoch(this.#workerEpoch);
    assertClientBuild(this.#clientBuild);
    this.#initTimeoutMs = normalizeTimeout(
      options.initTimeoutMs,
      STUDIO_QUALITY_WORKER_DEFAULT_INIT_TIMEOUT_MS,
    );
    this.#runTimeoutMs = normalizeTimeout(
      options.runTimeoutMs,
      STUDIO_QUALITY_WORKER_DEFAULT_RUN_TIMEOUT_MS,
    );
  }

  get workerEpoch(): number {
    return this.#workerEpoch;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  pathBoolean(
    a: string,
    b: string,
    op: StudioQualityPathOp,
    options?: StudioQualityWorkerRunOptions,
  ): Promise<StudioQualityWorkerClientResult> {
    return this.run({ kind: "path-boolean", a, b, op }, options);
  }

  strokeToFill(
    pathData: string,
    style: StudioStrokeToPathStyle,
    options?: StudioQualityWorkerRunOptions,
  ): Promise<StudioQualityWorkerClientResult> {
    return this.run({ kind: "stroke-to-fill", pathData, style }, options);
  }

  run(
    operation: StudioQualityWorkerOperation,
    options: StudioQualityWorkerRunOptions = {},
  ): Promise<StudioQualityWorkerClientResult> {
    if (this.#disposed) {
      return Promise.reject(clientError("disposed", "품질 Worker client가 종료되었습니다."));
    }
    if (this.#terminal) {
      return Promise.reject(clientError("worker-failed", "품질 Worker 세션을 다시 사용할 수 없습니다."));
    }
    if (options.signal?.aborted) {
      return Promise.reject(abortError("품질 연산을 시작하기 전에 취소했습니다."));
    }
    if (this.#pending.size >= STUDIO_QUALITY_WORKER_BUDGETS.maxQueuedRequests) {
      return Promise.reject(
        clientError("queue-full", "품질 Worker client 요청 큐가 가득 찼습니다."),
      );
    }

    let timeoutMs: number;
    try {
      timeoutMs = normalizeTimeout(options.timeoutMs, this.#runTimeoutMs);
    } catch (error) {
      return Promise.reject(
        clientError("invalid-input", "품질 Worker timeout 설정이 올바르지 않습니다.", error),
      );
    }

    const operationSnapshot = snapshotOperation(operation);
    const requestId = this.#nextRequestId;
    this.#nextRequestId = requestId >= Number.MAX_SAFE_INTEGER
      ? 1
      : requestId + 1;
    const requestToken = operationToken(
      this.#workerEpoch,
      requestId,
      operationSnapshot.kind,
    );
    const request: StudioQualityWorkerRequestMessage = {
      type: "studio-quality/request",
      protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
      workerEpoch: this.#workerEpoch,
      requestId,
      requestToken,
      operation: operationSnapshot,
    };
    if (!validateStudioQualityWorkerInboundMessage(request).ok) {
      return Promise.reject(
        clientError(
          "invalid-input",
          "품질 연산 입력이 프로토콜 형식 또는 안전 예산을 충족하지 않습니다.",
        ),
      );
    }
    const authority: StudioQualityWorkerRequestAuthority = {
      workerEpoch: this.#workerEpoch,
      requestId,
      requestToken,
      operationKind: operationSnapshot.kind,
    };

    return new Promise((resolve, reject) => {
      const pending: PendingRequest = {
        request,
        authority,
        signal: options.signal,
        resolve,
        reject,
        onAbort: () => {
          if (pending.posted && this.#worker) {
            const cancel: StudioQualityWorkerCancelMessage = {
              type: "studio-quality/cancel",
              protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
              workerEpoch: this.#workerEpoch,
              requestId,
              requestToken,
              operationKind: operationSnapshot.kind,
            };
            try {
              this.#worker.postMessage(cancel);
            } catch {
              // The local AbortError remains authoritative even if the advisory cancel cannot post.
            }
          }
          this.#finish(
            pending,
            abortError("진행 중인 품질 연산을 취소했습니다."),
          );
        },
        timer: null,
        posted: false,
        settled: false,
      };
      this.#pending.set(requestId, pending);
      options.signal?.addEventListener("abort", pending.onAbort, { once: true });
      if (options.signal?.aborted) {
        pending.onAbort();
        return;
      }
      void this.#ensureReady().then(
        () => {
          if (pending.settled || !this.#pending.has(requestId)) return;
          const worker = this.#worker;
          if (!worker) {
            this.#finish(
              pending,
              clientError("worker-failed", "초기화된 품질 Worker가 사라졌습니다."),
            );
            return;
          }
          try {
            worker.postMessage(request);
            pending.posted = true;
          } catch (error) {
            this.#finish(
              pending,
              clientError(
                "post-failed",
                "품질 연산을 Worker에 전달하지 못했습니다.",
                error,
              ),
            );
            return;
          }
          pending.timer = setTimeout(() => {
            const cancel: StudioQualityWorkerCancelMessage = {
              type: "studio-quality/cancel",
              protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
              workerEpoch: this.#workerEpoch,
              requestId,
              requestToken,
              operationKind: operationSnapshot.kind,
            };
            try {
              worker.postMessage(cancel);
            } catch {
              // Timeout settlement must not depend on best-effort cancellation delivery.
            }
            this.#finish(
              pending,
              clientError(
                "timeout",
                `품질 Worker가 ${timeoutMs}ms 안에 응답하지 않았습니다.`,
              ),
            );
          }, timeoutMs);
        },
        (error) => {
          if (!pending.settled) this.#finish(pending, error);
        },
      );
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#worker) {
      try {
        this.#worker.postMessage({
          type: "studio-quality/dispose",
          protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
          workerEpoch: this.#workerEpoch,
        });
      } catch {
        // Termination below remains the hard ownership boundary.
      }
    }
    const error = clientError("disposed", "품질 Worker client를 종료했습니다.");
    this.#failSession(error);
  }

  #ensureReady(): Promise<StudioQualityWorkerReadyMessage> {
    if (this.#ready) return Promise.resolve(this.#ready);
    if (this.#readyPromise) return this.#readyPromise;
    if (!this.#workerFactory) {
      return Promise.reject(
        clientError(
          "worker-unavailable",
          "격리된 품질 Worker를 사용할 수 없습니다.",
        ),
      );
    }

    let worker: StudioQualityWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch (error) {
      return Promise.reject(
        clientError(
          "worker-unavailable",
          "품질 Worker 생성에 실패했습니다.",
          error,
        ),
      );
    }
    if (!worker) {
      return Promise.reject(
        clientError(
          "worker-unavailable",
          "이 환경은 격리된 품질 Worker를 지원하지 않습니다.",
        ),
      );
    }
    this.#worker = worker;
    worker.onmessage = (event) => this.#handleMessage(event.data);
    worker.onerror = (event) => {
      event.preventDefault?.();
      const message = event.error instanceof Error && event.error.message
        ? event.error.message
        : event.message || "품질 Worker가 비정상 종료되었습니다.";
      this.#failSession(
        clientError("worker-failed", message, event.error),
      );
    };
    worker.onmessageerror = () => {
      this.#failSession(
        clientError("protocol", "품질 Worker 응답을 구조 복제하지 못했습니다."),
      );
    };
    this.#readyPromise = new Promise((resolve, reject) => {
      this.#resolveReady = resolve;
      this.#rejectReady = reject;
    });
    this.#initTimer = setTimeout(() => {
      this.#failSession(
        clientError(
          "timeout",
          `품질 Worker 초기화가 ${this.#initTimeoutMs}ms 안에 끝나지 않았습니다.`,
        ),
      );
    }, this.#initTimeoutMs);
    try {
      worker.postMessage({
        type: "studio-quality/initialize",
        protocolRevision: STUDIO_QUALITY_WORKER_PROTOCOL_REVISION,
        workerEpoch: this.#workerEpoch,
        clientBuild: this.#clientBuild,
      });
    } catch (error) {
      this.#failSession(
        clientError(
          "post-failed",
          "품질 Worker 초기화 메시지를 전달하지 못했습니다.",
          error,
        ),
      );
    }
    return this.#readyPromise;
  }

  #handleMessage(value: unknown): void {
    if (this.#terminal || this.#disposed) return;
    if (!isStudioQualityWorkerResponseMessage(value)) {
      this.#failSession(
        clientError("protocol", "품질 Worker 응답 프로토콜이 올바르지 않습니다."),
      );
      return;
    }
    if (
      value.workerEpoch !== null
      && value.workerEpoch !== this.#workerEpoch
    ) {
      this.#failSession(
        clientError("epoch-mismatch", "품질 Worker 응답 epoch가 현재 세션과 다릅니다."),
      );
      return;
    }
    if (value.type === "studio-quality/ready") {
      if (this.#ready || !this.#resolveReady) {
        this.#failSession(
          clientError("protocol", "품질 Worker가 중복 ready 응답을 보냈습니다."),
        );
        return;
      }
      this.#clearInitTimer();
      this.#ready = value;
      const resolve = this.#resolveReady;
      this.#resolveReady = null;
      this.#rejectReady = null;
      resolve(value);
      return;
    }
    if (value.type === "studio-quality/fatal") {
      this.#failSession(
        clientError(value.error.code, value.error.message),
      );
      return;
    }
    if (value.type === "studio-quality/disposed") {
      this.#failSession(
        clientError("worker-failed", "품질 Worker가 예기치 않게 종료되었습니다."),
      );
      return;
    }
    if (!this.#ready) {
      this.#failSession(
        clientError("protocol", "품질 Worker가 ready 전에 연산 응답을 보냈습니다."),
      );
      return;
    }
    const identity = studioQualityWorkerResponseIdentity(value);
    if (!identity) {
      this.#failSession(
        clientError("protocol", "품질 Worker 응답 상관키가 없습니다."),
      );
      return;
    }
    const pending = this.#pending.get(identity.requestId);
    if (!pending) {
      if (identity.requestId <= this.#settledThroughRequestId) return;
      this.#failSession(
        clientError("protocol", "품질 Worker가 알 수 없는 요청 응답을 보냈습니다."),
      );
      return;
    }
    if (!isStudioQualityWorkerResponseForAuthority(value, pending.authority)) {
      this.#failSession(
        clientError("protocol", "품질 Worker 응답이 요청 상관키와 일치하지 않습니다."),
      );
      return;
    }
    if (value.type === "studio-quality/result") {
      this.#finish(pending, {
        execution: "quality-worker",
        providerId: value.providerId,
        workerEpoch: value.workerEpoch,
        requestId: value.requestId,
        requestToken: value.requestToken,
        operationKind: value.operationKind,
        result: value.result,
      });
      return;
    }
    if (value.type === "studio-quality/cancelled") {
      this.#finish(
        pending,
        abortError("품질 Worker가 연산 취소를 확인했습니다."),
      );
      return;
    }
    this.#finish(
      pending,
      clientError(value.error.code, value.error.message),
    );
  }

  #finish(
    pending: PendingRequest,
    outcome: StudioQualityWorkerClientResult | StudioQualityWorkerClientError,
  ): void {
    if (pending.settled) return;
    pending.settled = true;
    if (pending.timer !== null) clearTimeout(pending.timer);
    pending.timer = null;
    pending.signal?.removeEventListener("abort", pending.onAbort);
    this.#pending.delete(pending.request.requestId);
    this.#settledThroughRequestId = Math.max(
      this.#settledThroughRequestId,
      pending.request.requestId,
    );
    if (outcome instanceof StudioQualityWorkerClientError) {
      pending.reject(outcome);
    } else {
      pending.resolve(outcome);
    }
  }

  #clearInitTimer(): void {
    if (this.#initTimer !== null) clearTimeout(this.#initTimer);
    this.#initTimer = null;
  }

  #failSession(
    error: StudioQualityWorkerClientError,
  ): void {
    if (this.#terminal) return;
    this.#terminal = true;
    this.#clearInitTimer();
    const rejectReady = this.#rejectReady;
    this.#resolveReady = null;
    this.#rejectReady = null;
    rejectReady?.(error);
    for (const pending of [...this.#pending.values()]) {
      this.#finish(pending, error);
    }
    if (this.#worker) {
      this.#worker.onmessage = null;
      this.#worker.onerror = null;
      this.#worker.onmessageerror = null;
      safely(() => this.#worker?.terminate());
    }
    this.#worker = null;
    this.#ready = null;
  }
}
