import {
  createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
  isStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage,
  normalizeStudioFirstPartyWillV1DocumentCodecWorkerRequest,
  parseStudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage,
  studioFirstPartyWillV1DocumentCodecWorkerRequestTransfers,
  studioFirstPartyWillV1DocumentCodecWorkerResponseCorrelation,
  type StudioFirstPartyWillV1DocumentCodecWorkerExpectedResponse,
  type StudioFirstPartyWillV1DocumentCodecWorkerFailureCode,
  type StudioFirstPartyWillV1DocumentCodecWorkerResult,
  type StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
} from "./studio-first-party-will-v1-document-codec-worker-protocol";

import type {
  StudioCodecExecutionRequest,
  StudioCodecProviderFailureCode,
} from "./studio-codec-provider-contract";

export * from "./studio-first-party-will-v1-document-codec-worker-protocol";

export const
STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_DEFAULT_TIMEOUT_MS =
  120_000;
export const
STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MIN_TIMEOUT_MS =
  120_000;
export const
STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MAX_TIMEOUT_MS =
  600_000;

export type StudioFirstPartyWillV1DocumentCodecWorkerClientErrorCode =
  | StudioFirstPartyWillV1DocumentCodecWorkerFailureCode
  | "worker-aborted"
  | "worker-disposed"
  | "worker-message-error"
  | "worker-post-failed"
  | "worker-protocol"
  | "worker-runtime"
  | "worker-timeout"
  | "worker-unavailable";

const CLIENT_MESSAGES: Readonly<
  Record<
    StudioFirstPartyWillV1DocumentCodecWorkerClientErrorCode,
    string
  >
> = Object.freeze({
  "budget-exceeded": "WILL v1 문서 코덱 Worker 요청이 안전 예산을 초과했습니다.",
  "execution-failed": "WILL v1 문서 코덱 Worker 실행을 완료하지 못했습니다.",
  "invalid-request": "WILL v1 문서 코덱 Worker 요청이 올바르지 않습니다.",
  "protocol-error": "WILL v1 문서 코덱 Worker 요청 프로토콜이 올바르지 않습니다.",
  "provider-failure": "WILL v1 문서 코덱 공급자가 요청을 완료하지 못했습니다.",
  "unsupported-direction": "요청한 WILL v1 문서 코덱 방향을 지원하지 않습니다.",
  "unsupported-format": "요청한 WILL v1 문서 코덱 형식을 지원하지 않습니다.",
  "unsupported-profile": "요청한 WILL v1 문서 코덱 프로필을 지원하지 않습니다.",
  "unsupported-version": "요청한 WILL v1 문서 코덱 버전을 지원하지 않습니다.",
  "worker-aborted": "WILL v1 문서 코덱 Worker 실행을 취소했습니다.",
  "worker-disposed": "종료된 WILL v1 문서 코덱 Worker client는 사용할 수 없습니다.",
  "worker-message-error": "WILL v1 문서 코덱 Worker 응답을 복제하지 못했습니다.",
  "worker-post-failed": "WILL v1 문서 코덱 Worker 실행을 시작하지 못했습니다.",
  "worker-protocol": "WILL v1 문서 코덱 Worker 응답 프로토콜이 올바르지 않습니다.",
  "worker-runtime": "WILL v1 문서 코덱 Worker가 비정상 종료되었습니다.",
  "worker-timeout": "WILL v1 문서 코덱 Worker 실행 시간이 초과되었습니다.",
  "worker-unavailable": "이 환경에서는 WILL v1 문서 코덱 Worker를 사용할 수 없습니다.",
});

export class StudioFirstPartyWillV1DocumentCodecWorkerClientError
  extends Error {
  readonly code:
    StudioFirstPartyWillV1DocumentCodecWorkerClientErrorCode;
  readonly providerCode: StudioCodecProviderFailureCode | null;

  constructor(
    code: StudioFirstPartyWillV1DocumentCodecWorkerClientErrorCode,
    providerCode: StudioCodecProviderFailureCode | null = null,
  ) {
    super(CLIENT_MESSAGES[code]);
    this.name =
      code === "worker-aborted"
        ? "AbortError"
        : code === "worker-timeout"
          ? "TimeoutError"
          : "StudioFirstPartyWillV1DocumentCodecWorkerClientError";
    this.code = code;
    this.providerCode = providerCode;
  }
}

export interface StudioFirstPartyWillV1DocumentCodecWorkerLike {
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
    message: StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
    transfer: Transferable[],
  ): void;
  terminate(): void;
}

export type StudioFirstPartyWillV1DocumentCodecWorkerFactory =
  () => StudioFirstPartyWillV1DocumentCodecWorkerLike | null;

export interface StudioFirstPartyWillV1DocumentCodecWorkerClientOptions {
  readonly workerFactory?:
    | StudioFirstPartyWillV1DocumentCodecWorkerFactory
    | null;
  readonly timeoutMs?: number;
}

export interface StudioFirstPartyWillV1DocumentCodecWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface RunStudioFirstPartyWillV1DocumentCodecWorkerOptions
  extends
    StudioFirstPartyWillV1DocumentCodecWorkerClientOptions,
    StudioFirstPartyWillV1DocumentCodecWorkerRunOptions {}

interface ActiveJob {
  readonly requestId: number;
  readonly worker: StudioFirstPartyWillV1DocumentCodecWorkerLike;
  readonly signal: AbortSignal | undefined;
  expected:
    StudioFirstPartyWillV1DocumentCodecWorkerExpectedResponse | null;
  readonly resolve: (
    result: StudioFirstPartyWillV1DocumentCodecWorkerResult,
  ) => void;
  readonly reject: (error: unknown) => void;
  readonly onAbort: () => void;
  validatingResponse: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** Vite emits this exact URL as an isolated module Worker chunk. */
export function createStudioFirstPartyWillV1DocumentCodecModuleWorker():
  StudioFirstPartyWillV1DocumentCodecWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-first-party-will-v1-document-codec.worker.ts",
      import.meta.url,
    ),
    {
      type: "module",
      name: "toonspectrum-first-party-will-v1-document-codec",
    },
  ) as unknown as StudioFirstPartyWillV1DocumentCodecWorkerLike;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout =
    value
    ?? STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout)
    || timeout
      < STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MIN_TIMEOUT_MS
    || timeout
      > STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_MAX_TIMEOUT_MS
  ) {
    throw new RangeError(
      "timeoutMs is outside the first-party WILL v1 document codec Worker limits.",
    );
  }
  return timeout;
}

function protocolError():
  StudioFirstPartyWillV1DocumentCodecWorkerClientError {
  return new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
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
): StudioFirstPartyWillV1DocumentCodecWorkerClientError {
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
      return new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
        code,
      );
    }
  }
  return new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
    "invalid-request",
  );
}

export class StudioFirstPartyWillV1DocumentCodecWorkerClient {
  readonly #workerFactory:
    | StudioFirstPartyWillV1DocumentCodecWorkerFactory
    | null;
  readonly #defaultTimeoutMs: number;
  #active: ActiveJob | null = null;
  #disposed = false;
  #lastRequestId = 0;

  constructor(
    options:
      StudioFirstPartyWillV1DocumentCodecWorkerClientOptions = {},
  ) {
    this.#workerFactory =
      options.workerFactory === undefined
        ? createStudioFirstPartyWillV1DocumentCodecModuleWorker
        : options.workerFactory;
    this.#defaultTimeoutMs = normalizeTimeout(options.timeoutMs);
  }

  get hasActiveJob(): boolean {
    return this.#active !== null;
  }

  run(
    request: StudioCodecExecutionRequest,
    inputBytes: Uint8Array,
    options:
      StudioFirstPartyWillV1DocumentCodecWorkerRunOptions = {},
  ): Promise<StudioFirstPartyWillV1DocumentCodecWorkerResult> {
    if (this.#disposed) {
      return Promise.reject(
        new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
          "worker-disposed",
        ),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
          "worker-aborted",
        ),
      );
    }
    if (!this.#workerFactory) {
      return Promise.reject(
        new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
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
        normalizeStudioFirstPartyWillV1DocumentCodecWorkerRequest(
          request,
        );
      if (
        !(inputBytes instanceof Uint8Array)
        || inputBytes.byteLength < 1
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
      new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
        "worker-aborted",
      ),
    );
    this.#lastRequestId = requestId;

    let worker:
      StudioFirstPartyWillV1DocumentCodecWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch {
      worker = null;
    }
    if (!worker) {
      return Promise.reject(
        new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
          "worker-unavailable",
        ),
      );
    }

    let message:
      StudioFirstPartyWillV1DocumentCodecWorkerRunMessage;
    try {
      message =
        createStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(
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
              new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
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
            new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
              "worker-runtime",
            ),
          ),
        );
      };
      worker.onmessageerror = () => {
        this.#finish(
          job,
          () => reject(
            new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
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
            new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
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
      new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
        "worker-aborted",
      ),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelActive(
      new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
        "worker-aborted",
      ),
    );
  }

  async #prepareAndPost(
    job: ActiveJob,
    message: StudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
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
        studioFirstPartyWillV1DocumentCodecWorkerRequestTransfers(
          message,
        ),
      );
    } catch {
      this.#finish(
        job,
        () => job.reject(
          new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
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
      studioFirstPartyWillV1DocumentCodecWorkerResponseCorrelation(value);
    if (correlation !== null && correlation !== job.requestId) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    if (correlation === null) {
      this.#finish(job, () => job.reject(protocolError()));
      return;
    }
    if (
      isStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(value)
    ) {
      this.#finish(
        job,
        () => job.reject(
          new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
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
      await parseStudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage(
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
    error: StudioFirstPartyWillV1DocumentCodecWorkerClientError,
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
      // Worker termination is best-effort; promise settlement remains deterministic.
    }
    settle();
  }
}

/**
 * One-shot convenience API. It never runs the provider directly; certification owns any bounded
 * startup fallback decision.
 */
export async function runStudioFirstPartyWillV1DocumentCodecWorker(
  request: StudioCodecExecutionRequest,
  inputBytes: Uint8Array,
  options:
    RunStudioFirstPartyWillV1DocumentCodecWorkerOptions = {},
): Promise<StudioFirstPartyWillV1DocumentCodecWorkerResult> {
  let client: StudioFirstPartyWillV1DocumentCodecWorkerClient;
  try {
    client = new StudioFirstPartyWillV1DocumentCodecWorkerClient({
      workerFactory: options.workerFactory,
      timeoutMs: options.timeoutMs,
    });
  } catch {
    throw new StudioFirstPartyWillV1DocumentCodecWorkerClientError(
      "invalid-request",
    );
  }
  try {
    return await client.run(request, inputBytes, {
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  } finally {
    client.dispose();
  }
}
