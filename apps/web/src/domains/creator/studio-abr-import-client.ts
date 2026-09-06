import {
  STUDIO_ABR_IMPORT_LIMITS,
  StudioAbrImportError,
  isStudioAbrImportErrorCode,
  parseStudioAbrBuffer,
  type StudioAbrImportResult,
} from "./studio-abr-import";
import {
  STUDIO_ABR_WORKER_PROTOCOL_VERSION,
  type StudioAbrWorkerRequest,
  type StudioAbrWorkerResponse,
} from "./studio-abr-import-worker-protocol";

export const STUDIO_ABR_WORKER_TIMEOUT_MS = 45_000;
export type StudioAbrImportExecutionBackend = "worker" | "direct";

interface WorkerLike {
  postMessage(message: StudioAbrWorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: () => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: () => void): void;
  terminate(): void;
}

export interface StudioAbrImportClientOptions {
  /** Fixed before the file is read. Browser product callers select `worker`. */
  readonly executionBackend?: StudioAbrImportExecutionBackend;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Test/platform seam for the selected Worker backend. */
  readonly workerFactory?: (() => WorkerLike | null) | null;
  /** Explicit direct/reference provider; never used by the Worker backend. */
  readonly directImporter?: (
    bytes: ArrayBuffer,
  ) => StudioAbrImportResult | Promise<StudioAbrImportResult>;
}

function isResponse(value: unknown, requestId: number): value is StudioAbrWorkerResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (
    record.version !== STUDIO_ABR_WORKER_PROTOCOL_VERSION
    || record.requestId !== requestId
    || typeof record.ok !== "boolean"
  ) return false;
  if (!record.ok) return isStudioAbrImportErrorCode(record.code);
  if (!record.result || typeof record.result !== "object") return false;
  const result = record.result as Record<string, unknown>;
  return Array.isArray(result.brushes)
    && Number.isSafeInteger(result.sourceBrushCount)
    && Number.isSafeInteger(result.sourceSampleCount)
    && Number.isSafeInteger(result.skippedBrushCount)
    && Number.isSafeInteger(result.approximatedBrushCount);
}

function fileNameLooksLikeAbr(file: File): boolean {
  return /\.abr$/iu.test(file.name)
    || file.type === "application/x-photoshop"
    || file.type === "application/octet-stream";
}

function defaultWorkerFactory(): WorkerLike {
  return new Worker(new URL("./studio-abr-import.worker.ts", import.meta.url), { type: "module" });
}

/**
 * Decode ABR away from the interaction thread. A one-shot worker is deliberately terminated after
 * every import so malformed third-party parsers cannot retain memory or state across files.
 */
export async function importStudioAbrFile(
  file: File,
  options: StudioAbrImportClientOptions = {}
): Promise<StudioAbrImportResult> {
  const executionBackend = options.executionBackend ?? "worker";
  if (executionBackend !== "worker" && executionBackend !== "direct") {
    throw new TypeError("ABR 가져오기 실행 backend가 올바르지 않습니다.");
  }
  if (!fileNameLooksLikeAbr(file)) throw new StudioAbrImportError("file-type");
  if (file.size === 0) throw new StudioAbrImportError("empty");
  if (file.size > STUDIO_ABR_IMPORT_LIMITS.maxBytes) throw new StudioAbrImportError("file-size");
  if (options.signal?.aborted) throw new StudioAbrImportError("aborted");
  const bytes = await file.arrayBuffer();
  if (options.signal?.aborted) throw new StudioAbrImportError("aborted");
  if (executionBackend === "direct") {
    return (options.directImporter ?? parseStudioAbrBuffer)(bytes);
  }

  const factory = options.workerFactory === undefined
    ? defaultWorkerFactory
    : options.workerFactory;
  if (!factory) throw new StudioAbrImportError("worker");
  let createdWorker: WorkerLike | null;
  try {
    createdWorker = factory();
  } catch (cause) {
    throw new StudioAbrImportError("worker", { cause });
  }
  if (!createdWorker) throw new StudioAbrImportError("worker");
  const worker = createdWorker;
  const requestId = 1;
  const timeoutMs = Math.max(1_000, Math.min(120_000, options.timeoutMs ?? STUDIO_ABR_WORKER_TIMEOUT_MS));
  return new Promise<StudioAbrImportResult>((resolve, reject) => {
    let settled = false;
    const finish = (result: { ok: true; value: StudioAbrImportResult } | { ok: false; error: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onFailure);
      worker.removeEventListener("messageerror", onFailure);
      worker.terminate();
      if (result.ok) resolve(result.value);
      else reject(result.error);
    };
    const onMessage = (event: MessageEvent<unknown>) => {
      if (!isResponse(event.data, requestId)) {
        finish({ ok: false, error: new StudioAbrImportError("worker") });
        return;
      }
      const response = event.data;
      if (response.ok) finish({ ok: true, value: response.result });
      else finish({ ok: false, error: new StudioAbrImportError(response.code) });
    };
    const onFailure = () => finish({ ok: false, error: new StudioAbrImportError("worker") });
    const onAbort = () => finish({ ok: false, error: new StudioAbrImportError("aborted") });
    const timeout = setTimeout(
      () => finish({ ok: false, error: new StudioAbrImportError("timeout") }),
      timeoutMs
    );
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onFailure);
    worker.addEventListener("messageerror", onFailure);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    const request: StudioAbrWorkerRequest = {
      version: STUDIO_ABR_WORKER_PROTOCOL_VERSION,
      requestId,
      bytes,
    };
    try {
      worker.postMessage(request, [bytes]);
    } catch {
      finish({ ok: false, error: new StudioAbrImportError("worker") });
    }
  });
}
