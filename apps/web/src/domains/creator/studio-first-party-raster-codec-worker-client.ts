import {
  createStudioFirstPartyRasterCodecWorkerRunMessage,
  isStudioFirstPartyRasterCodecWorkerFailureMessage,
  normalizeStudioFirstPartyRasterCodecWorkerRequest,
  parseStudioFirstPartyRasterCodecWorkerSuccessMessage,
  studioFirstPartyRasterCodecWorkerRequestTransfers,
  studioFirstPartyRasterCodecWorkerResponseCorrelation,
  type StudioFirstPartyRasterCodecWorkerExpectedResponse,
  type StudioFirstPartyRasterCodecWorkerFailureCode,
  type StudioFirstPartyRasterCodecWorkerResult,
  type StudioFirstPartyRasterCodecWorkerRunMessage,
} from "./studio-first-party-raster-codec-worker-protocol";

import type {
  StudioCodecExecutionRequest,
  StudioCodecProviderFailureCode,
} from "./studio-codec-provider-contract";

export * from "./studio-first-party-raster-codec-worker-protocol";

export const STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_DEFAULT_TIMEOUT_MS =
  120_000;
export const STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_MAX_TIMEOUT_MS =
  600_000;

export type StudioFirstPartyRasterCodecWorkerClientErrorCode =
  | StudioFirstPartyRasterCodecWorkerFailureCode
  | "worker-aborted"
  | "worker-disposed"
  | "worker-message-error"
  | "worker-post-failed"
  | "worker-protocol"
  | "worker-runtime"
  | "worker-timeout"
  | "worker-unavailable";

const CLIENT_MESSAGES:
  Readonly<Record<StudioFirstPartyRasterCodecWorkerClientErrorCode, string>> =
  Object.freeze({
    "budget-exceeded": "래스터 코덱 Worker 요청이 안전 예산을 초과했습니다.",
    "execution-failed": "래스터 코덱 Worker 실행을 안전하게 완료하지 못했습니다.",
    "invalid-request": "래스터 코덱 Worker 요청이 올바르지 않습니다.",
    "protocol-error": "래스터 코덱 Worker 요청 프로토콜이 올바르지 않습니다.",
    "provider-failure": "래스터 코덱 공급자가 요청을 완료하지 못했습니다.",
    "unsupported-direction": "요청한 래스터 코덱 방향을 지원하지 않습니다.",
    "unsupported-format": "요청한 래스터 코덱 형식을 지원하지 않습니다.",
    "unsupported-profile": "요청한 래스터 코덱 프로필을 지원하지 않습니다.",
    "unsupported-version": "요청한 래스터 코덱 버전을 지원하지 않습니다.",
    "worker-aborted": "래스터 코덱 Worker 실행을 취소했습니다.",
    "worker-disposed": "종료된 래스터 코덱 Worker client는 사용할 수 없습니다.",
    "worker-message-error": "래스터 코덱 Worker 응답을 복제하지 못했습니다.",
    "worker-post-failed": "래스터 코덱 Worker에 요청을 전달하지 못했습니다.",
    "worker-protocol": "래스터 코덱 Worker 응답 프로토콜이 올바르지 않습니다.",
    "worker-runtime": "래스터 코덱 Worker가 비정상 종료되었습니다.",
    "worker-timeout": "래스터 코덱 Worker 실행 시간이 초과되었습니다.",
    "worker-unavailable": "이 환경에서는 래스터 코덱 Worker를 사용할 수 없습니다.",
  });

export class StudioFirstPartyRasterCodecWorkerClientError extends Error {
  readonly code: StudioFirstPartyRasterCodecWorkerClientErrorCode;
  readonly providerCode: StudioCodecProviderFailureCode | null;

  constructor(
    code: StudioFirstPartyRasterCodecWorkerClientErrorCode,
    providerCode: StudioCodecProviderFailureCode | null = null,
  ) {
    super(CLIENT_MESSAGES[code]);
    this.name =
      code === "worker-aborted"
        ? "AbortError"
        : code === "worker-timeout"
          ? "TimeoutError"
          : "StudioFirstPartyRasterCodecWorkerClientError";
    this.code = code;
    this.providerCode = providerCode;
  }
}

export interface StudioFirstPartyRasterCodecWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror:
    | ((
      event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      },
    ) => void)
    | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(
    message: StudioFirstPartyRasterCodecWorkerRunMessage,
    transfer: Transferable[],
  ): void;
  terminate(): void;
}

export type StudioFirstPartyRasterCodecWorkerFactory =
  () => StudioFirstPartyRasterCodecWorkerLike | null;

export interface StudioFirstPartyRasterCodecWorkerClientOptions {
  readonly workerFactory?:
    | StudioFirstPartyRasterCodecWorkerFactory
    | null;
  readonly timeoutMs?: number;
}

export interface StudioFirstPartyRasterCodecWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface RunStudioFirstPartyRasterCodecWorkerOptions
  extends
    StudioFirstPartyRasterCodecWorkerClientOptions,
    StudioFirstPartyRasterCodecWorkerRunOptions {}

interface ActiveJob {
  readonly requestId: number;
  readonly worker: StudioFirstPartyRasterCodecWorkerLike;
  readonly signal: AbortSignal | undefined;
  expected: StudioFirstPartyRasterCodecWorkerExpectedResponse | null;
  readonly resolve: (
    result: StudioFirstPartyRasterCodecWorkerResult,
  ) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
  validatingResponse: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Vite emits this exact URL as an isolated module Worker chunk. */
export function createStudioFirstPartyRasterCodecModuleWorker():
  StudioFirstPartyRasterCodecWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-first-party-raster-codec.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "toonspectrum-first-party-raster-codec",
    },
  ) as unknown as StudioFirstPartyRasterCodecWorkerLike;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout =
    value
    ?? STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout)
    || timeout < 1
    || timeout > STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      "timeoutMs is outside the first-party raster codec Worker limits.",
    );
  }
  return timeout;
}

function protocolError():
  StudioFirstPartyRasterCodecWorkerClientError {
  return new StudioFirstPartyRasterCodecWorkerClientError(
    "worker-protocol",
  );
}

async function hash(
  bytes: ArrayBuffer,
): Promise<`sha256:${string}` | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = new Uint8Array(
      await subtle.digest("SHA-256", bytes),
    );
    return `sha256:${[...digest]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  } catch {
    return null;
  }
}

function requestError(
  error: unknown,
): StudioFirstPartyRasterCodecWorkerClientError {
  if (
    error !== null
    && typeof error === "object"
    && "code" in error
  ) {
    const code = Reflect.get(error, "code");
    if (
      typeof code === "string"
      && (
        code === "budget-exceeded"
        || code === "invalid-request"
        || code === "protocol-error"
        || code === "unsupported-direction"
        || code === "unsupported-format"
        || code === "unsupported-profile"
        || code === "unsupported-version"
      )
    ) {
      return new StudioFirstPartyRasterCodecWorkerClientError(code);
    }
  }
  return new StudioFirstPartyRasterCodecWorkerClientError(
    "invalid-request",
  );
}

export class StudioFirstPartyRasterCodecWorkerClient {
  readonly #workerFactory:
    | StudioFirstPartyRasterCodecWorkerFactory
    | null;
  readonly #defaultTimeoutMs: number;
  #active: ActiveJob | null = null;
  #disposed = false;
  #lastRequestId = 0;

  constructor(
    options: StudioFirstPartyRasterCodecWorkerClientOptions = {},
  ) {
    this.#workerFactory =
      options.workerFactory === undefined
        ? createStudioFirstPartyRasterCodecModuleWorker
        : options.workerFactory;
    this.#defaultTimeoutMs = normalizeTimeout(options.timeoutMs);
  }

  get hasActiveJob(): boolean {
    return this.#active !== null;
  }

  run(
    request: StudioCodecExecutionRequest,
    inputBytes: Uint8Array,
    options: StudioFirstPartyRasterCodecWorkerRunOptions = {},
  ): Promise<StudioFirstPartyRasterCodecWorkerResult> {
    if (this.#disposed) {
      return Promise.reject(
        new StudioFirstPartyRasterCodecWorkerClientError(
          "worker-disposed",
        ),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        new StudioFirstPartyRasterCodecWorkerClientError(
          "worker-aborted",
        ),
      );
    }
    if (!this.#workerFactory) {
      return Promise.reject(
        new StudioFirstPartyRasterCodecWorkerClientError(
          "worker-unavailable",
        ),
      );
    }

    let requestId: number;
    let timeoutMs: number;
    let normalizedRequest: StudioCodecExecutionRequest;
    try {
      requestId = this.#lastRequestId + 1;
      if (!Number.isSafeInteger(requestId)) {
        throw new RangeError("requestId overflow");
      }
      normalizedRequest =
        normalizeStudioFirstPartyRasterCodecWorkerRequest(request);
      if (
        !(inputBytes instanceof Uint8Array)
        || inputBytes.byteLength > normalizedRequest.maxInputBytes
      ) {
        throw new RangeError("inputBytes is outside the request budget");
      }
      timeoutMs = normalizeTimeout(
        options.timeoutMs ?? this.#defaultTimeoutMs,
      );
    } catch (error) {
      return Promise.reject(requestError(error));
    }

    this.#cancelActive(
      new StudioFirstPartyRasterCodecWorkerClientError(
        "worker-aborted",
      ),
    );
    this.#lastRequestId = requestId;

    let worker: StudioFirstPartyRasterCodecWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch {
      worker = null;
    }
    if (!worker) {
      return Promise.reject(
        new StudioFirstPartyRasterCodecWorkerClientError(
          "worker-unavailable",
        ),
      );
    }

    let message: StudioFirstPartyRasterCodecWorkerRunMessage;
    try {
      message = createStudioFirstPartyRasterCodecWorkerRunMessage(
        requestId,
        normalizedRequest,
        inputBytes,
      );
    } catch (error) {
      try {
        worker.terminate();
      } catch {
        // Worker creation succeeded but no job was posted.
      }
      return Promise.reject(requestError(error));
    }

    return new Promise((resolve, reject) => {
      const job: ActiveJob = {
        requestId,
        worker,
        signal: options.signal,
        expected: null,
        resolve,
        reject,
        timer: null,
        validatingResponse: false,
        onAbort: () => {
          this.#finish(
            job,
            () => reject(
              new StudioFirstPartyRasterCodecWorkerClientError(
                "worker-aborted",
              ),
            ),
          );
        },
      };
      this.#active = job;
      worker.onmessage = (event) => {
        void this.#handleMessage(job, event.data);
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        this.#finish(
          job,
          () => reject(
            new StudioFirstPartyRasterCodecWorkerClientError(
              "worker-runtime",
            ),
          ),
        );
      };
      worker.onmessageerror = () => {
        this.#finish(
          job,
          () => reject(
            new StudioFirstPartyRasterCodecWorkerClientError(
              "worker-message-error",
            ),
          ),
        );
      };
      options.signal?.addEventListener("abort", job.onAbort, {
        once: true,
      });
      if (options.signal?.aborted) {
        job.onAbort();
        return;
      }
      job.timer = setTimeout(() => {
        this.#finish(
          job,
          () => reject(
            new StudioFirstPartyRasterCodecWorkerClientError(
              "worker-timeout",
            ),
          ),
        );
      }, timeoutMs);
      void this.#prepareAndPost(job, message);
    });
  }

  cancel(): void {
    this.#cancelActive(
      new StudioFirstPartyRasterCodecWorkerClientError(
        "worker-aborted",
      ),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelActive(
      new StudioFirstPartyRasterCodecWorkerClientError(
        "worker-aborted",
      ),
    );
  }

  async #prepareAndPost(
    job: ActiveJob,
    message: StudioFirstPartyRasterCodecWorkerRunMessage,
  ): Promise<void> {
    const inputByteLength = message.inputBytes.byteLength;
    const inputSha256 = await hash(message.inputBytes);
    if (this.#active !== job) return;
    if (!inputSha256) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    job.expected = Object.freeze({
      requestId: job.requestId,
      request: message.request,
      inputByteLength,
      inputSha256,
    });
    try {
      job.worker.postMessage(
        message,
        studioFirstPartyRasterCodecWorkerRequestTransfers(message),
      );
    } catch {
      this.#finish(
        job,
        () => job.reject(
          new StudioFirstPartyRasterCodecWorkerClientError(
            "worker-post-failed",
          ),
        ),
      );
    }
  }

  async #handleMessage(job: ActiveJob, value: unknown): Promise<void> {
    if (this.#active !== job) return;
    if (job.validatingResponse) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    const correlation =
      studioFirstPartyRasterCodecWorkerResponseCorrelation(value);
    if (correlation !== null && correlation !== job.requestId) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    if (correlation === null) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    if (isStudioFirstPartyRasterCodecWorkerFailureMessage(value)) {
      this.#finish(
        job,
        () => job.reject(
          new StudioFirstPartyRasterCodecWorkerClientError(
            value.error.code,
            value.error.providerCode,
          ),
        ),
      );
      return;
    }
    job.validatingResponse = true;
    const expected = job.expected;
    if (!expected) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    const result =
      await parseStudioFirstPartyRasterCodecWorkerSuccessMessage(
        value,
        expected,
      );
    if (this.#active !== job) return;
    if (!result) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    this.#finish(job, () => job.resolve(result));
  }

  #cancelActive(
    error: StudioFirstPartyRasterCodecWorkerClientError,
  ): void {
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
      // Termination is best-effort, but settlement must remain deterministic.
    }
    settle();
  }
}

/**
 * One-shot convenience API. Worker absence or failure is explicit; the raster provider is never
 * run on the main thread as a fallback.
 */
export async function runStudioFirstPartyRasterCodecWorker(
  request: StudioCodecExecutionRequest,
  inputBytes: Uint8Array,
  options: RunStudioFirstPartyRasterCodecWorkerOptions = {},
): Promise<StudioFirstPartyRasterCodecWorkerResult> {
  const client = new StudioFirstPartyRasterCodecWorkerClient({
    workerFactory: options.workerFactory,
    timeoutMs: options.timeoutMs,
  });
  try {
    return await client.run(request, inputBytes, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  } finally {
    client.dispose();
  }
}
