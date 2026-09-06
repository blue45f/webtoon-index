import {
  STUDIO_WILL_V1_LIMITS,
  type StudioWillV1Limits,
} from "./studio-will-v1-interchange";
import {
  STUDIO_WILL_V1_OPC_LIMITS,
  type StudioWillV1OpcBuildResult,
  type StudioWillV1OpcExportInput,
  type StudioWillV1OpcImportResult,
  type StudioWillV1OpcLimits,
} from "./studio-will-v1-opc-interchange";
import {
  StudioWillV1OpcPackedError,
  packStudioWillV1OpcExportInput,
  unpackStudioWillV1OpcBuildResult,
  unpackStudioWillV1OpcImportResultWithMetrics,
  type StudioWillV1OpcImportMaterializationMetrics,
} from "./studio-will-v1-opc-packed-codec";
import {
  STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
  isStudioWillV1OpcWorkerResponse,
  studioWillV1OpcWorkerCorrelation,
  studioWillV1OpcWorkerRequestTransfers,
  type StudioWillV1OpcWorkerCodecOptions,
  type StudioWillV1OpcWorkerFailure,
  type StudioWillV1OpcWorkerFailureCode,
  type StudioWillV1OpcWorkerRequest,
  type StudioWillV1OpcWorkerResponse,
} from "./studio-will-v1-opc-worker-protocol";

export const STUDIO_WILL_V1_OPC_WORKER_DEFAULT_TIMEOUT_MS = 120_000;
export const STUDIO_WILL_V1_OPC_WORKER_MAX_TIMEOUT_MS = 600_000;

export type StudioWillV1OpcWorkerClientErrorCode =
  | StudioWillV1OpcWorkerFailureCode
  | "OPTIONS_INVALID"
  | "SOURCE_INVALID"
  | "WORKER_POST_FAILED"
  | "WORKER_PROTOCOL"
  | "WORKER_RUNTIME"
  | "WORKER_TIMEOUT"
  | "WORKER_UNAVAILABLE";

export class StudioWillV1OpcWorkerClientError extends Error {
  readonly code: StudioWillV1OpcWorkerClientErrorCode;
  readonly path?: string;

  constructor(
    code: StudioWillV1OpcWorkerClientErrorCode,
    message: string,
    options: { readonly path?: string } = {}
  ) {
    super(message);
    this.name = "StudioWillV1OpcWorkerClientError";
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
  }
}

export interface StudioWillV1OpcWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioWillV1OpcWorkerRequest, transfer: Transferable[]): void;
  terminate(): void;
}

export type StudioWillV1OpcWorkerFactory = () => StudioWillV1OpcWorkerLike | null;

export interface StudioWillV1OpcWorkerOptions {
  readonly limits?: Partial<StudioWillV1OpcLimits>;
  readonly willLimits?: Partial<StudioWillV1Limits>;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workerFactory?: StudioWillV1OpcWorkerFactory | null;
  /** Test/host injection point. Returned IDs still pass the bounded protocol validator. */
  readonly requestIdFactory?: () => string;
  /**
   * Local observability hook; it is never cloned into the Worker request. A callback failure is
   * ignored so telemetry cannot alter a validated import.
   */
  readonly onDecodeMaterialization?: (
    metrics: StudioWillV1OpcImportMaterializationMetrics,
  ) => void;
}

type StudioWillV1OpcWorkerSource = Blob | Uint8Array | ArrayBuffer;
type WorkerOperation = "decode" | "encode";

interface ResolvedClientBudgets {
  readonly limits: StudioWillV1OpcLimits;
  readonly willLimits: StudioWillV1Limits;
}

let fallbackRequestSequence = 0;

/** Vite discovers this literal URL and emits a dedicated module-Worker chunk. */
export function createStudioWillV1OpcModuleWorker(): StudioWillV1OpcWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-will-v1-opc.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-will-v1-opc",
  }) as unknown as StudioWillV1OpcWorkerLike;
}

function clientError(
  code: StudioWillV1OpcWorkerClientErrorCode,
  message: string,
  options?: { readonly path?: string }
): StudioWillV1OpcWorkerClientError {
  return new StudioWillV1OpcWorkerClientError(code, message, options);
}

function abortError(): StudioWillV1OpcWorkerClientError {
  const error = clientError("ABORTED", "WILL v1 OPC Worker 작업을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function timeoutError(timeoutMs: number): StudioWillV1OpcWorkerClientError {
  const error = clientError(
    "WORKER_TIMEOUT",
    `WILL v1 OPC Worker가 ${timeoutMs}ms 안에 응답하지 않았습니다.`
  );
  error.name = "TimeoutError";
  return error;
}

function protocolError(message: string): StudioWillV1OpcWorkerClientError {
  return clientError("WORKER_PROTOCOL", message);
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? STUDIO_WILL_V1_OPC_WORKER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isInteger(timeout)
    || timeout < 1
    || timeout > STUDIO_WILL_V1_OPC_WORKER_MAX_TIMEOUT_MS
  ) {
    throw clientError(
      "OPTIONS_INVALID",
      `timeoutMs는 1 이상 ${STUDIO_WILL_V1_OPC_WORKER_MAX_TIMEOUT_MS} 이하의 정수여야 합니다.`
    );
  }
  return timeout;
}

function validRequestId(value: string): boolean {
  if (value.length < 1 || value.length > 128) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

function createRequestId(factory?: () => string): string {
  let value: unknown;
  try {
    if (factory) {
      value = factory();
    } else if (typeof globalThis.crypto?.randomUUID === "function") {
      value = globalThis.crypto.randomUUID();
    } else {
      fallbackRequestSequence += 1;
      value = `will-v1-opc-${Date.now().toString(36)}-${fallbackRequestSequence.toString(36)}`;
    }
  } catch {
    throw clientError(
      "OPTIONS_INVALID",
      "WILL v1 OPC Worker request ID를 만들지 못했습니다.",
    );
  }
  if (typeof value !== "string" || !validRequestId(value)) {
    throw clientError("OPTIONS_INVALID", "WILL v1 OPC Worker request ID가 올바르지 않습니다.");
  }
  return value;
}

function codecOptions(
  budgets: ResolvedClientBudgets,
): StudioWillV1OpcWorkerCodecOptions {
  return {
    limits: { ...budgets.limits },
    willLimits: { ...budgets.willLimits },
  };
}

function createWorker(
  factory: StudioWillV1OpcWorkerFactory | null
): StudioWillV1OpcWorkerLike {
  if (!factory) {
    throw clientError(
      "WORKER_UNAVAILABLE",
      "이 브라우저에서는 전용 WILL v1 OPC Web Worker를 사용할 수 없습니다."
    );
  }
  let worker: StudioWillV1OpcWorkerLike | null;
  try {
    worker = factory();
  } catch {
    throw clientError(
      "WORKER_UNAVAILABLE",
      "전용 WILL v1 OPC Web Worker를 시작하지 못했습니다."
    );
  }
  if (!worker) {
    throw clientError(
      "WORKER_UNAVAILABLE",
      "이 브라우저에서는 전용 WILL v1 OPC Web Worker를 사용할 수 없습니다."
    );
  }
  return worker;
}

function deserializeFailure(
  response: StudioWillV1OpcWorkerFailure
): StudioWillV1OpcWorkerClientError {
  const error = clientError(response.error.code, response.error.message, {
    path: response.error.path,
  });
  error.name = response.error.name;
  return error;
}

function safeTerminate(worker: StudioWillV1OpcWorkerLike): void {
  try {
    worker.terminate();
  } catch {
    // Termination is best-effort at the host API level; handlers are still detached below.
  }
}

async function runWorker(
  worker: StudioWillV1OpcWorkerLike,
  request: StudioWillV1OpcWorkerRequest,
  operation: WorkerOperation,
  timeoutMs: number,
  signal: AbortSignal | undefined
): Promise<StudioWillV1OpcWorkerResponse> {
  return await new Promise<StudioWillV1OpcWorkerResponse>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timer !== null) globalThis.clearTimeout(timer);
      timer = null;
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      safeTerminate(worker);
    };
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      settle();
    };
    const onAbort = () => finish(() => reject(abortError()));

    worker.onmessage = (event) => {
      if (settled) return;
      try {
        const correlation = studioWillV1OpcWorkerCorrelation(event.data);
        if (
          correlation
          && correlation.requestId !== request.requestId
        ) {
          finish(() =>
            reject(
              protocolError(
                "WILL v1 OPC Worker 응답 request ID가 일치하지 않습니다.",
              ),
            )
          );
          return;
        }
        if (!correlation) {
          finish(() => reject(protocolError("WILL v1 OPC Worker 응답에 request ID가 없습니다.")));
          return;
        }
        if (!isStudioWillV1OpcWorkerResponse(event.data)) {
          finish(() => reject(protocolError("WILL v1 OPC Worker 응답 프로토콜이 올바르지 않습니다.")));
          return;
        }
        const response = event.data;
        if (response.type === "studio-will-v1-opc/failure") {
          if (response.operation !== operation) {
            finish(() => reject(protocolError("WILL v1 OPC Worker 실패 응답 작업이 일치하지 않습니다.")));
            return;
          }
          finish(() => reject(deserializeFailure(response)));
          return;
        }
        const expectedType = operation === "encode"
          ? "studio-will-v1-opc/encode-success"
          : "studio-will-v1-opc/decode-success";
        if (response.type !== expectedType) {
          finish(() => reject(protocolError("WILL v1 OPC Worker 성공 응답 작업이 일치하지 않습니다.")));
          return;
        }
        finish(() => resolve(response));
      } catch {
        finish(() =>
          reject(
            protocolError(
              "WILL v1 OPC Worker 응답을 안전하게 검증하지 못했습니다.",
            ),
          )
        );
      }
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      finish(() =>
        reject(
          clientError(
            "WORKER_RUNTIME",
            "WILL v1 OPC Worker 실행 중 오류가 발생했습니다.",
          )
        )
      );
    };
    worker.onmessageerror = () => {
      finish(() =>
        reject(protocolError("WILL v1 OPC Worker 응답을 structured clone하지 못했습니다."))
      );
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = globalThis.setTimeout(
      () => finish(() => reject(timeoutError(timeoutMs))),
      timeoutMs
    );
    try {
      worker.postMessage(request, studioWillV1OpcWorkerRequestTransfers(request));
    } catch {
      finish(() =>
        reject(
          clientError(
            "WORKER_POST_FAILED",
            "WILL v1 OPC Worker에 요청을 전달하지 못했습니다."
          )
        )
      );
    }
  });
}

function workerFactory(options: StudioWillV1OpcWorkerOptions): StudioWillV1OpcWorkerFactory | null {
  return options.workerFactory === undefined
    ? createStudioWillV1OpcModuleWorker
    : options.workerFactory;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function resolveClientLimit(
  supplied: number | undefined,
  hardMaximum: number,
  optionName: string
): number {
  if (supplied === undefined) return hardMaximum;
  if (
    !Number.isSafeInteger(supplied)
    || supplied < 0
    || supplied > hardMaximum
  ) {
    throw clientError(
      "OPTIONS_INVALID",
      `${optionName}은(는) 0 이상 ${hardMaximum} 이하의 safe integer여야 합니다.`
    );
  }
  return supplied;
}

function resolveClientBudgets(
  options: StudioWillV1OpcWorkerOptions
): ResolvedClientBudgets {
  try {
    return {
      limits: {
        maxArchiveBytes: resolveClientLimit(
          options.limits?.maxArchiveBytes,
          STUDIO_WILL_V1_OPC_LIMITS.maxArchiveBytes,
          "limits.maxArchiveBytes"
        ),
        maxXmlPartBytes: resolveClientLimit(
          options.limits?.maxXmlPartBytes,
          STUDIO_WILL_V1_OPC_LIMITS.maxXmlPartBytes,
          "limits.maxXmlPartBytes"
        ),
        maxStrokesBytes: resolveClientLimit(
          options.limits?.maxStrokesBytes,
          STUDIO_WILL_V1_OPC_LIMITS.maxStrokesBytes,
          "limits.maxStrokesBytes"
        ),
        maxMetadataCharacters: resolveClientLimit(
          options.limits?.maxMetadataCharacters,
          STUDIO_WILL_V1_OPC_LIMITS.maxMetadataCharacters,
          "limits.maxMetadataCharacters"
        ),
        maxDimension: resolveClientLimit(
          options.limits?.maxDimension,
          STUDIO_WILL_V1_OPC_LIMITS.maxDimension,
          "limits.maxDimension"
        ),
        maxXmlDepth: resolveClientLimit(
          options.limits?.maxXmlDepth,
          STUDIO_WILL_V1_OPC_LIMITS.maxXmlDepth,
          "limits.maxXmlDepth"
        ),
        maxXmlElements: resolveClientLimit(
          options.limits?.maxXmlElements,
          STUDIO_WILL_V1_OPC_LIMITS.maxXmlElements,
          "limits.maxXmlElements"
        ),
        maxXmlAttributesPerElement: resolveClientLimit(
          options.limits?.maxXmlAttributesPerElement,
          STUDIO_WILL_V1_OPC_LIMITS.maxXmlAttributesPerElement,
          "limits.maxXmlAttributesPerElement"
        ),
      },
      willLimits: {
        maxStrokesBytes: resolveClientLimit(
          options.willLimits?.maxStrokesBytes,
          STUDIO_WILL_V1_LIMITS.maxStrokesBytes,
          "willLimits.maxStrokesBytes"
        ),
        maxPathMessageBytes: resolveClientLimit(
          options.willLimits?.maxPathMessageBytes,
          STUDIO_WILL_V1_LIMITS.maxPathMessageBytes,
          "willLimits.maxPathMessageBytes"
        ),
        maxPaths: resolveClientLimit(
          options.willLimits?.maxPaths,
          STUDIO_WILL_V1_LIMITS.maxPaths,
          "willLimits.maxPaths"
        ),
        maxPointsPerPath: resolveClientLimit(
          options.willLimits?.maxPointsPerPath,
          STUDIO_WILL_V1_LIMITS.maxPointsPerPath,
          "willLimits.maxPointsPerPath"
        ),
        maxTotalPoints: resolveClientLimit(
          options.willLimits?.maxTotalPoints,
          STUDIO_WILL_V1_LIMITS.maxTotalPoints,
          "willLimits.maxTotalPoints"
        ),
        maxDecimalPrecision: resolveClientLimit(
          options.willLimits?.maxDecimalPrecision,
          STUDIO_WILL_V1_LIMITS.maxDecimalPrecision,
          "willLimits.maxDecimalPrecision"
        ),
        maxCoordinateMagnitude: resolveClientLimit(
          options.willLimits?.maxCoordinateMagnitude,
          STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude,
          "willLimits.maxCoordinateMagnitude"
        ),
        maxStrokeWidth: resolveClientLimit(
          options.willLimits?.maxStrokeWidth,
          STUDIO_WILL_V1_LIMITS.maxStrokeWidth,
          "willLimits.maxStrokeWidth"
        ),
      },
    };
  } catch (error) {
    if (error instanceof StudioWillV1OpcWorkerClientError) throw error;
    throw clientError(
      "OPTIONS_INVALID",
      "WILL v1 OPC Worker 안전 한도가 올바르지 않습니다.",
    );
  }
}

function resourceLimit(message: string): never {
  throw clientError("RESOURCE_LIMIT", message);
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function preflightEncodeInput(
  input: StudioWillV1OpcExportInput,
  budgets: ResolvedClientBudgets
): void {
  try {
    if (
      !input
      || typeof input !== "object"
      || typeof input.width !== "number"
      || !Number.isFinite(input.width)
      || input.width <= 0
      || input.width > budgets.limits.maxDimension
      || Number(input.width.toFixed(6)) !== input.width
      || typeof input.height !== "number"
      || !Number.isFinite(input.height)
      || input.height <= 0
      || input.height > budgets.limits.maxDimension
      || Number(input.height.toFixed(6)) !== input.height
    ) {
      throw clientError("DIMENSION_INVALID", "WILL v1 OPC 문서 크기가 올바르지 않습니다.");
    }
    if (!Array.isArray(input.paths) || input.paths.length < 1) {
      throw clientError("STROKES_INVALID", "WILL v1 OPC path 목록이 올바르지 않습니다.");
    }
    if (input.paths.length > budgets.willLimits.maxPaths) {
      resourceLimit("WILL v1 OPC path 수가 요청한 안전 한도를 넘었습니다.");
    }
    let totalPoints = 0;
    for (const path of input.paths) {
      if (!path || typeof path !== "object" || !Array.isArray(path.points)) {
        throw clientError("STROKES_INVALID", "WILL v1 OPC path 구조가 올바르지 않습니다.");
      }
      if (path.points.length < 4) {
        throw clientError("STROKES_INVALID", "WILL v1 OPC path point 수가 올바르지 않습니다.");
      }
      if (path.points.length > budgets.willLimits.maxPointsPerPath) {
        resourceLimit("WILL v1 OPC path point 수가 요청한 안전 한도를 넘었습니다.");
      }
      totalPoints += path.points.length;
      if (totalPoints > budgets.willLimits.maxTotalPoints) {
        resourceLimit("WILL v1 OPC 전체 point 수가 요청한 안전 한도를 넘었습니다.");
      }
      if (
        !Array.isArray(path.strokeWidths)
        || path.strokeWidths.length < 1
        || path.strokeWidths.length > path.points.length
      ) {
        throw clientError("STROKES_INVALID", "WILL v1 OPC stroke width 구조가 올바르지 않습니다.");
      }
    }
    const metadata = [
      input.title ?? "Untitled",
      input.createdAt ?? "1980-01-01T00:00:00Z",
      input.application ?? "ToonSpectrum",
      input.applicationVersion ?? "1.0",
    ];
    if (
      metadata.some(
        (value) => {
          if (typeof value !== "string") return true;
          const length = codePointLength(value);
          return length < 1 || length > budgets.limits.maxMetadataCharacters;
        }
      )
    ) {
      throw clientError("METADATA_INVALID", "WILL v1 OPC metadata가 안전 한도를 넘었습니다.");
    }
    if (codePointLength(metadata[3]!) > 64) {
      throw clientError("METADATA_INVALID", "WILL v1 OPC application version이 너무 깁니다.");
    }
    if (
      input.createdAt !== undefined
      && (
        typeof input.createdAt !== "string"
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(input.createdAt)
      )
    ) {
      throw clientError("METADATA_INVALID", "WILL v1 OPC 생성 시각이 올바르지 않습니다.");
    }
  } catch (error) {
    if (error instanceof StudioWillV1OpcWorkerClientError) throw error;
    throw clientError(
      "STROKES_INVALID",
      "WILL v1 OPC 입력을 안전하게 사전 검증하지 못했습니다."
    );
  }
}

function assertSourceBudget(byteLength: number, maximum: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw clientError("SOURCE_INVALID", "WILL v1 OPC 입력 크기가 올바르지 않습니다.");
  }
  if (byteLength > maximum) {
    throw clientError("RESOURCE_LIMIT", "WILL v1 OPC 입력이 archive 안전 한도를 넘었습니다.");
  }
}

function snapshotSource(
  source: StudioWillV1OpcWorkerSource,
  maximumArchiveBytes: number
): Uint8Array | Blob {
  try {
    if (source instanceof Uint8Array) {
      assertSourceBudget(source.byteLength, maximumArchiveBytes);
      return new Uint8Array(source);
    }
    if (source instanceof ArrayBuffer) {
      assertSourceBudget(source.byteLength, maximumArchiveBytes);
      return new Uint8Array(source.slice(0));
    }
    if (typeof Blob !== "undefined" && source instanceof Blob) {
      assertSourceBudget(source.size, maximumArchiveBytes);
      return source;
    }
  } catch (error) {
    if (error instanceof StudioWillV1OpcWorkerClientError) throw error;
    throw clientError(
      "SOURCE_INVALID",
      "WILL v1 OPC 입력을 복사하지 못했습니다.",
    );
  }
  throw clientError("SOURCE_INVALID", "지원하지 않는 WILL v1 OPC Worker 입력입니다.");
}

function mapPackedError(error: unknown): never {
  if (!(error instanceof StudioWillV1OpcPackedError)) {
    throw protocolError("WILL v1 OPC packed transport를 처리하지 못했습니다.");
  }
  if (error.code === "RESOURCE_LIMIT") {
    throw clientError("RESOURCE_LIMIT", error.message);
  }
  if (error.code === "MODEL_INVALID") {
    throw clientError("STROKES_INVALID", error.message);
  }
  throw protocolError("WILL v1 OPC packed transport가 올바르지 않습니다.");
}

export async function buildStudioWillV1OpcBytesInWorker(
  input: StudioWillV1OpcExportInput,
  options: StudioWillV1OpcWorkerOptions = {}
): Promise<StudioWillV1OpcBuildResult> {
  throwIfAborted(options.signal);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const budgets = resolveClientBudgets(options);
  preflightEncodeInput(input, budgets);
  let packedInput: Uint8Array;
  try {
    packedInput = packStudioWillV1OpcExportInput(input, codecOptions(budgets));
  } catch (error) {
    mapPackedError(error);
  }
  const requestId = createRequestId(options.requestIdFactory);
  const worker = createWorker(workerFactory(options));
  const request: StudioWillV1OpcWorkerRequest = {
    type: "studio-will-v1-opc/encode",
    version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
    requestId,
    packedInput,
    options: codecOptions(budgets),
  };
  const response = await runWorker(worker, request, "encode", timeoutMs, options.signal);
  if (response.type !== "studio-will-v1-opc/encode-success") {
    throw protocolError("WILL v1 OPC Worker 인코딩 결과가 올바르지 않습니다.");
  }
  if (response.archive.byteLength > budgets.limits.maxArchiveBytes) {
    throw protocolError("WILL v1 OPC Worker archive가 요청한 안전 한도를 넘었습니다.");
  }
  try {
    return unpackStudioWillV1OpcBuildResult(
      response.archive,
      response.packedResult,
      codecOptions(budgets),
    );
  } catch (error) {
    mapPackedError(error);
  }
}

export async function importStudioWillV1OpcInWorker(
  source: StudioWillV1OpcWorkerSource,
  options: StudioWillV1OpcWorkerOptions = {}
): Promise<StudioWillV1OpcImportResult> {
  throwIfAborted(options.signal);
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const budgets = resolveClientBudgets(options);
  const requestId = createRequestId(options.requestIdFactory);
  const workerSource = snapshotSource(source, budgets.limits.maxArchiveBytes);
  throwIfAborted(options.signal);
  const worker = createWorker(workerFactory(options));
  const request: StudioWillV1OpcWorkerRequest = {
    type: "studio-will-v1-opc/decode",
    version: STUDIO_WILL_V1_OPC_WORKER_PROTOCOL_VERSION,
    requestId,
    source: workerSource,
    options: codecOptions(budgets),
  };
  const response = await runWorker(worker, request, "decode", timeoutMs, options.signal);
  if (response.type !== "studio-will-v1-opc/decode-success") {
    throw protocolError("WILL v1 OPC Worker 디코딩 결과가 올바르지 않습니다.");
  }
  try {
    const decoded = unpackStudioWillV1OpcImportResultWithMetrics(
      response.packedResult,
      codecOptions(budgets),
    );
    try {
      options.onDecodeMaterialization?.(decoded.metrics);
    } catch {
      // Metrics are diagnostic only; imported model validity remains authoritative.
    }
    return decoded.result;
  } catch (error) {
    mapPackedError(error);
  }
}

/** Naming aliases for call sites that use the repository's `Async` Worker convention. */
export const buildStudioWillV1OpcBytesAsync = buildStudioWillV1OpcBytesInWorker;
export const importStudioWillV1OpcAsync = importStudioWillV1OpcInWorker;
