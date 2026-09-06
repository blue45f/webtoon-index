import {
  decodeStudioRasterInterchange,
  encodeStudioRasterInterchange,
  type StudioRasterDecoded,
  type StudioRasterEncoded,
  type StudioRasterInterchangeFormat,
  type StudioRgbaBitmap,
} from "./studio-raster-interchange";
import {
  parseStudioRasterInterchangeWorkerResponse,
  STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
  studioRasterInterchangeRequestTransfers,
  type StudioRasterInterchangeWorkerRequest,
  type StudioRasterInterchangeWorkerSuccessResponse,
} from "./studio-raster-interchange-worker-protocol";

export const STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_BYTES = 4 * 1024 * 1024;
export const STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_PIXELS = 1_048_576;
export const STUDIO_RASTER_INTERCHANGE_WORKER_READY_TIMEOUT_DEFAULT_MS = 2_000;
export const STUDIO_RASTER_INTERCHANGE_WORKER_READY_TIMEOUT_MAX_MS = 10_000;
export const
STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_DEFAULT_MS = 120_000;
export const
STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_MAX_MS = 600_000;

const STUDIO_RASTER_INTERCHANGE_WORKER_TIMEOUT_MIN_MS = 100;

export class StudioRasterInterchangeWorkerRequiredError extends Error {
  readonly code = "WORKER_REQUIRED" as const;

  constructor(message: string) {
    super(message);
    this.name = "StudioRasterInterchangeWorkerRequiredError";
  }
}

export interface StudioRasterInterchangeWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: { readonly message?: string; preventDefault?(): void }) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioRasterInterchangeWorkerRequest, transfers: Transferable[]): void;
  terminate(): void;
}

export type StudioRasterInterchangeWorkerFactory = () => StudioRasterInterchangeWorkerLike | null;

export interface StudioRasterInterchangeAsyncOptions {
  /** Selected once before work begins. Browser product callers must select `worker`. */
  readonly executionMode: "worker" | "direct";
  readonly signal?: AbortSignal;
  /** Test/platform seam for the selected Worker backend. */
  readonly workerFactory?: StudioRasterInterchangeWorkerFactory | null;
  /** Legacy-compatible Worker startup/ready deadline. It never limits codec execution. */
  readonly readyTimeoutMs?: number;
  /** Deadline applied only after ready and successful request transfer. */
  readonly operationTimeoutMs?: number;
}

export interface StudioRasterInterchangeAsyncResult {
  readonly execution: "direct" | "worker";
  readonly encoded: StudioRasterEncoded;
}

export interface StudioRasterDecodeAsyncResult {
  readonly execution: "direct" | "worker";
  readonly decoded: StudioRasterDecoded;
}

interface StudioRasterWorkerRunResult {
  readonly response: StudioRasterInterchangeWorkerSuccessResponse;
}

type StudioRasterEncodeSuccessResponse = Extract<
  StudioRasterInterchangeWorkerSuccessResponse,
  { readonly type: "studio-raster-interchange/encode-success" }
>;
type StudioRasterDecodeSuccessResponse = Extract<
  StudioRasterInterchangeWorkerSuccessResponse,
  { readonly type: "studio-raster-interchange/decode-success" }
>;

export function createStudioRasterInterchangeModuleWorker(): StudioRasterInterchangeWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-raster-interchange.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-raster-interchange",
  }) as unknown as StudioRasterInterchangeWorkerLike;
}

function abortError(): Error {
  if (typeof DOMException === "function") return new DOMException("래스터 작업을 취소했습니다.", "AbortError");
  const error = new Error("래스터 작업을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function workerRequired(operation: "인코딩" | "디코딩"): StudioRasterInterchangeWorkerRequiredError {
  return new StudioRasterInterchangeWorkerRequiredError(
    `이 래스터 ${operation}은 직접 처리 안전 상한(4MiB, 1,048,576픽셀)을 초과해 Web Worker가 필요합니다.`
  );
}

function bitmapExceedsDirectBudget(bitmap: StudioRgbaBitmap): boolean {
  const pixels = bitmap.width * bitmap.height;
  return bitmap.data.byteLength > STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_BYTES
    || (Number.isSafeInteger(pixels) && pixels > STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_PIXELS);
}

function directEncode(
  format: StudioRasterInterchangeFormat,
  bitmap: StudioRgbaBitmap,
  requestId: string
): StudioRasterEncodeSuccessResponse {
  if (bitmapExceedsDirectBudget(bitmap)) throw workerRequired("인코딩");
  return {
    type: "studio-raster-interchange/encode-success",
    version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    requestId,
    result: encodeStudioRasterInterchange(format, bitmap),
  };
}

function directDecode(
  bytes: Uint8Array,
  expectedFormat: StudioRasterInterchangeFormat | undefined,
  requestId: string
): StudioRasterDecodeSuccessResponse {
  if (bytes.byteLength > STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_BYTES) throw workerRequired("디코딩");
  try {
    return {
      type: "studio-raster-interchange/decode-success",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      requestId,
      result: decodeStudioRasterInterchange(bytes, expectedFormat, {
        maximumPixels: STUDIO_RASTER_INTERCHANGE_DIRECT_MAX_PIXELS,
      }),
    };
  } catch (error) {
    if (
      error instanceof Error
      && "code" in error
      && error.code === "OUTPUT_TOO_LARGE"
    ) {
      throw workerRequired("디코딩");
    }
    throw error;
  }
}

function createWorker(
  factory: StudioRasterInterchangeWorkerFactory | null
): StudioRasterInterchangeWorkerLike {
  let worker: StudioRasterInterchangeWorkerLike | null;
  try {
    worker = factory?.() ?? null;
  } catch {
    throw workerFailure(
      "래스터 Worker를 생성하지 못했습니다.",
      "StudioRasterInterchangeWorkerError",
    );
  }
  if (!worker) {
    throw workerFailure(
      "래스터 Worker를 사용할 수 없습니다.",
      "StudioRasterInterchangeWorkerError",
    );
  }
  return worker;
}

function boundedTimeout(
  value: number | undefined,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined) return defaultValue;
  const integer = Math.trunc(value);
  if (!Number.isFinite(integer)) return defaultValue;
  return Math.max(
    STUDIO_RASTER_INTERCHANGE_WORKER_TIMEOUT_MIN_MS,
    Math.min(maximum, integer),
  );
}

function workerFailure(message: string, name: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

function workerProtocolFailure(): Error {
  return workerFailure(
    "래스터 Worker 응답 프로토콜이 올바르지 않습니다.",
    "StudioRasterInterchangeWorkerError",
  );
}

async function runStudioRasterInterchangeWorker(
  worker: StudioRasterInterchangeWorkerLike,
  request: StudioRasterInterchangeWorkerRequest,
  options: StudioRasterInterchangeAsyncOptions
): Promise<StudioRasterWorkerRunResult> {
  const readyTimeoutMs = boundedTimeout(
    options.readyTimeoutMs,
    STUDIO_RASTER_INTERCHANGE_WORKER_READY_TIMEOUT_DEFAULT_MS,
    STUDIO_RASTER_INTERCHANGE_WORKER_READY_TIMEOUT_MAX_MS,
  );
  const operationTimeoutMs = boundedTimeout(
    options.operationTimeoutMs,
    STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_DEFAULT_MS,
    STUDIO_RASTER_INTERCHANGE_WORKER_OPERATION_TIMEOUT_MAX_MS,
  );

  return await new Promise<StudioRasterWorkerRunResult>((resolve, reject) => {
    let settled = false;
    let posted = false;
    let readyTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    let operationTimer: ReturnType<typeof globalThis.setTimeout> | null =
      null;
    const cleanup = () => {
      if (readyTimer !== null) {
        globalThis.clearTimeout(readyTimer);
        readyTimer = null;
      }
      if (operationTimer !== null) {
        globalThis.clearTimeout(operationTimer);
        operationTimer = null;
      }
      options.signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try {
        worker.terminate();
      } catch {
        // A broken terminate implementation must not prevent deterministic settlement.
      }
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(abortError()));
    readyTimer = globalThis.setTimeout(
      () => finish(() => reject(
        workerFailure(
          "래스터 Worker 준비 시간이 초과되었습니다.",
          "TimeoutError",
        ),
      )),
      readyTimeoutMs,
    );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish(() => reject(
        workerFailure(
          "래스터 Worker 실행을 안전하게 완료하지 못했습니다.",
          "StudioRasterInterchangeWorkerError",
        ),
      ));
    };
    worker.onmessage = (event) => {
      const response =
        parseStudioRasterInterchangeWorkerResponse(event.data);
      if (!response) {
        finish(() => reject(workerProtocolFailure()));
        return;
      }
      if (response.type === "studio-raster-interchange/ready") {
        if (posted) return;
        if (readyTimer !== null) {
          globalThis.clearTimeout(readyTimer);
          readyTimer = null;
        }
        try {
          worker.postMessage(
            request,
            studioRasterInterchangeRequestTransfers(request),
          );
          posted = true;
          operationTimer = globalThis.setTimeout(() => {
            finish(() => reject(
              workerFailure(
                "래스터 Worker 처리 시간이 초과되었습니다.",
                "TimeoutError",
              ),
            ));
          }, operationTimeoutMs);
        } catch {
          finish(() => reject(
            workerFailure(
              "래스터 Worker 요청을 시작하지 못했습니다.",
              "StudioRasterInterchangeWorkerError",
            ),
          ));
        }
        return;
      }
      if (response.requestId !== request.requestId) {
        finish(() => reject(workerProtocolFailure()));
        return;
      }
      if (!posted) {
        finish(() => reject(workerProtocolFailure()));
        return;
      }
      if (response.type === "studio-raster-interchange/failure") {
        finish(() => reject(
          workerFailure(
            response.error.message || "래스터 Worker가 작업을 완료하지 못했습니다.",
            response.error.name || "StudioRasterInterchangeWorkerError",
          ),
        ));
        return;
      }
      if (
        (
          request.type === "studio-raster-interchange/encode"
          && (
            response.type !== "studio-raster-interchange/encode-success"
            || response.result.extension !== `.${request.format}`
          )
        )
        || (
          request.type === "studio-raster-interchange/decode"
          && (
            response.type !== "studio-raster-interchange/decode-success"
            || (
              request.expectedFormat !== undefined
              && response.result.format !== request.expectedFormat
            )
          )
        )
      ) {
        finish(() => reject(workerProtocolFailure()));
        return;
      }
      finish(() => resolve({ response }));
    };
    worker.onmessageerror = () => {
      finish(() => reject(
        workerFailure(
          "래스터 Worker 응답을 복제하지 못했습니다.",
          "StudioRasterInterchangeWorkerError",
        ),
      ));
    };
  });
}

export async function encodeStudioRasterInterchangeAsync(
  format: StudioRasterInterchangeFormat,
  bitmap: StudioRgbaBitmap,
  options: StudioRasterInterchangeAsyncOptions,
): Promise<StudioRasterInterchangeAsyncResult> {
  if (options.signal?.aborted) throw abortError();
  const requestId = crypto.randomUUID();
  if (options.executionMode === "direct") {
    const response = directEncode(format, bitmap, requestId);
    return { execution: "direct", encoded: response.result };
  }
  if (options.executionMode !== "worker") {
    throw new TypeError("래스터 인코딩 실행 모드가 올바르지 않습니다.");
  }
  const factory = options.workerFactory === undefined
    ? createStudioRasterInterchangeModuleWorker
    : options.workerFactory;
  const worker = createWorker(factory);

  // Caller-owned ImageData and subarrays must never be detached at the Worker boundary.
  const data = new Uint8ClampedArray(bitmap.data);
  const request: StudioRasterInterchangeWorkerRequest = {
    type: "studio-raster-interchange/encode",
    version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    requestId,
    format,
    width: bitmap.width,
    height: bitmap.height,
    data,
  };
  const result = await runStudioRasterInterchangeWorker(
    worker,
    request,
    options
  );
  if (result.response.type !== "studio-raster-interchange/encode-success") {
    throw new Error("래스터 Worker가 인코딩 요청에 잘못된 응답을 반환했습니다.");
  }
  return { execution: "worker", encoded: result.response.result };
}

export async function decodeStudioRasterInterchangeAsync(
  source: Uint8Array | ArrayBuffer,
  expectedFormat: StudioRasterInterchangeFormat | undefined,
  options: StudioRasterInterchangeAsyncOptions,
): Promise<StudioRasterDecodeAsyncResult> {
  if (options.signal?.aborted) throw abortError();
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  const requestId = crypto.randomUUID();
  if (options.executionMode === "direct") {
    const response = directDecode(bytes, expectedFormat, requestId);
    return { execution: "direct", decoded: response.result };
  }
  if (options.executionMode !== "worker") {
    throw new TypeError("래스터 디코딩 실행 모드가 올바르지 않습니다.");
  }
  const factory = options.workerFactory === undefined
    ? createStudioRasterInterchangeModuleWorker
    : options.workerFactory;
  const worker = createWorker(factory);

  // Copy every view (including offset subarrays) so transferring cannot detach caller memory.
  const workerBytes = new Uint8Array(bytes);
  const request: StudioRasterInterchangeWorkerRequest = {
    type: "studio-raster-interchange/decode",
    version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
    requestId,
    bytes: workerBytes,
    expectedFormat,
  };
  const result = await runStudioRasterInterchangeWorker(
    worker,
    request,
    options
  );
  if (result.response.type !== "studio-raster-interchange/decode-success") {
    throw new Error("래스터 Worker가 디코딩 요청에 잘못된 응답을 반환했습니다.");
  }
  return { execution: "worker", decoded: result.response.result };
}
