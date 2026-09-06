import {
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_DATA_URL_CHARS,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_HEIGHT,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES,
  STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_WIDTH,
} from "./studio-companion-reference-raster-worker-protocol";

export * from "./studio-companion-reference-raster-worker-protocol";

const DEFAULT_DEADLINE_MS = 8_000;
const MINIMUM_DEADLINE_MS = 250;
const MAXIMUM_DEADLINE_MS = 15_000;

export interface StudioCompanionReferenceRasterWorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: Event) => void): void;
}

export interface StudioCompanionReferenceWorkerRaster {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface StudioCompanionReferenceRasterWorkerProcessor {
  hashDataUrl(dataUrl: string, signal: AbortSignal): Promise<string>;
  normalizeRaster(
    raster: StudioCompanionReferenceWorkerRaster,
    maximumOutputPixels: number,
    signal: AbortSignal
  ): Promise<StudioCompanionReferenceWorkerRaster | null>;
  release(): void;
}

export interface StudioCompanionReferenceRasterWorkerProcessorOptions {
  createWorker?: () => StudioCompanionReferenceRasterWorkerLike;
  fallbackHashDataUrl(dataUrl: string): Promise<string>;
  fallbackNormalizeRaster(
    raster: StudioCompanionReferenceWorkerRaster,
    maximumOutputPixels: number
  ): Promise<StudioCompanionReferenceWorkerRaster | null>
    | StudioCompanionReferenceWorkerRaster
    | null;
  deadlineMs?: number;
  now?: () => number;
}

type ActiveJob = {
  epoch: number;
  id: string;
  kind: "hash" | "normalize";
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal: AbortSignal;
  abort: () => void;
  timeout: ReturnType<typeof setTimeout>;
};

function defaultWorkerFactory(): StudioCompanionReferenceRasterWorkerLike {
  return new Worker(
    new URL("./studio-companion-reference-raster-worker.ts", import.meta.url),
    { type: "module", name: "toonspectrum-reference-raster" }
  );
}

function abortError(message = "Reference raster job aborted"): DOMException {
  return new DOMException(message, "AbortError");
}

function timeoutError(): DOMException {
  return new DOMException("Reference raster worker deadline exceeded", "TimeoutError");
}

function safeTerminate(worker: StudioCompanionReferenceRasterWorkerLike | null): void {
  try {
    worker?.terminate();
  } catch {
    // A crashed or already terminated worker needs no additional cleanup.
  }
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validRasterInput(
  raster: StudioCompanionReferenceWorkerRaster,
  maximumOutputPixels: number
): boolean {
  if (
    !raster
    || !positiveSafeInteger(raster.width)
    || !positiveSafeInteger(raster.height)
    || !positiveSafeInteger(maximumOutputPixels)
    || maximumOutputPixels * 4 > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES
  ) return false;
  const pixels = raster.width * raster.height;
  if (!Number.isSafeInteger(pixels) || pixels * 4 > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_INPUT_BYTES) {
    return false;
  }
  try {
    return raster.pixels instanceof Uint8ClampedArray
      && raster.pixels.byteOffset === 0
      && raster.pixels.byteLength === pixels * 4
      && raster.pixels.buffer instanceof ArrayBuffer
      && raster.pixels.buffer.byteLength === raster.pixels.byteLength;
  } catch {
    return false;
  }
}

function validateHashResponse(value: unknown): string | null {
  const record = plainRecord(value);
  return record
    && record.kind === "hash-result"
    && typeof record.hash === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(record.hash)
    ? record.hash
    : null;
}

function workerJobError(value: unknown): Error | null {
  const record = plainRecord(value);
  if (
    !record
    || record.kind !== "job-error"
    || !["deadline", "invalid-input", "processing-failed"].includes(String(record.code))
  ) return null;
  return new Error(`Reference raster worker rejected job: ${String(record.code)}`);
}

function validateNormalizeResponse(
  value: unknown,
  maximumOutputPixels: number
): StudioCompanionReferenceWorkerRaster | null {
  const record = plainRecord(value);
  if (
    !record
    || record.kind !== "normalize-result"
    || !positiveSafeInteger(record.width)
    || !positiveSafeInteger(record.height)
    || record.width > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_WIDTH
    || record.height > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_HEIGHT
    || !(record.buffer instanceof ArrayBuffer)
  ) return null;
  const pixels = record.width * record.height;
  if (
    !Number.isSafeInteger(pixels)
    || pixels > maximumOutputPixels
    || pixels * 4 > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES
    || record.buffer.byteLength !== pixels * 4
  ) return null;
  return { width: record.width, height: record.height, pixels: new Uint8ClampedArray(record.buffer) };
}

function validateFallbackNormalizeResponse(
  value: unknown,
  maximumOutputPixels: number
): StudioCompanionReferenceWorkerRaster | null {
  if (value === null) return null;
  const record = plainRecord(value);
  if (
    !record
    || !positiveSafeInteger(record.width)
    || !positiveSafeInteger(record.height)
    || record.width > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_WIDTH
    || record.height > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_HEIGHT
    || !(record.pixels instanceof Uint8ClampedArray)
  ) throw new TypeError("Reference raster fallback response is invalid");
  const pixels = record.width * record.height;
  try {
    if (
      !Number.isSafeInteger(pixels)
      || pixels > maximumOutputPixels
      || pixels * 4 > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_OUTPUT_BYTES
      || record.pixels.byteOffset !== 0
      || record.pixels.byteLength !== pixels * 4
      || !(record.pixels.buffer instanceof ArrayBuffer)
      || record.pixels.buffer.byteLength !== record.pixels.byteLength
    ) throw new TypeError("Reference raster fallback response is invalid");
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Reference raster fallback response is invalid", { cause: error });
  }
  return { width: record.width, height: record.height, pixels: record.pixels };
}

/** Demand-owned processor. Creation is lazy; only hard worker failures trip its lifetime breaker. */
export function createStudioCompanionReferenceRasterWorkerProcessor(
  options: StudioCompanionReferenceRasterWorkerProcessorOptions
): StudioCompanionReferenceRasterWorkerProcessor {
  const createWorker = options.createWorker ?? defaultWorkerFactory;
  const now = options.now ?? Date.now;
  const requestedDeadlineMs = typeof options.deadlineMs === "number"
    && Number.isFinite(options.deadlineMs)
    ? Math.round(options.deadlineMs)
    : DEFAULT_DEADLINE_MS;
  const deadlineMs = Math.min(
    MAXIMUM_DEADLINE_MS,
    Math.max(MINIMUM_DEADLINE_MS, requestedDeadlineMs)
  );
  const processorController = new AbortController();
  let epoch = 1;
  let sequence = 0;
  let worker: StudioCompanionReferenceRasterWorkerLike | null = null;
  let workerFailureListener: ((event: Event) => void) | null = null;
  let workerUnavailable = false;
  let released = false;
  let active: ActiveJob | null = null;

  const releaseFallbackRaster = (value: unknown) => {
    try {
      if (!value || typeof value !== "object") return;
      const pixels = Object.getOwnPropertyDescriptor(value, "pixels")?.value as unknown;
      if (pixels instanceof Uint8ClampedArray) {
        Reflect.apply(Uint8ClampedArray.prototype.fill, pixels, [0]);
      }
    } catch {
      // Detached or hostile late fallback output cannot be published by this processor.
    }
  };

  const runFallbackWithDeadline = <T>(
    operation: () => Promise<T> | T,
    signal: AbortSignal,
    deadlineAt: number,
    releaseLateValue?: (value: T) => void
  ): Promise<T> => new Promise<T>((resolve, reject) => {
    if (released || signal.aborted || processorController.signal.aborted) {
      reject(abortError());
      return;
    }
    const remainingMs = deadlineAt - now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      reject(timeoutError());
      return;
    }
    let accepting = true;
    const cleanup = () => {
      clearTimeout(timeout);
      try {
        signal.removeEventListener("abort", onAbort);
      } catch {
        // A host signal cannot retain the settled fallback gate.
      }
      processorController.signal.removeEventListener("abort", onAbort);
    };
    const settleRejected = (reason: unknown) => {
      if (!accepting) return;
      accepting = false;
      cleanup();
      reject(reason);
    };
    const onAbort = () => settleRejected(abortError());
    const timeout = setTimeout(() => settleRejected(timeoutError()), remainingMs);
    try {
      signal.addEventListener("abort", onAbort, { once: true });
      processorController.signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted || processorController.signal.aborted) onAbort();
    } catch {
      onAbort();
    }
    Promise.resolve().then(() => {
      if (!accepting || released || signal.aborted || processorController.signal.aborted) {
        throw abortError();
      }
      return operation();
    }).then(
      (value) => {
        if (!accepting) {
          try {
            releaseLateValue?.(value);
          } catch {
            // Late fallback ownership is best-effort released and never published.
          }
          return;
        }
        accepting = false;
        cleanup();
        resolve(value);
      },
      (error: unknown) => settleRejected(error)
    );
  });

  const runFallbackNormalize = async (
    raster: StudioCompanionReferenceWorkerRaster,
    maximumOutputPixels: number,
    signal: AbortSignal,
    deadlineAt: number
  ): Promise<StudioCompanionReferenceWorkerRaster | null> => {
    if (released || signal.aborted) throw abortError();
    const fallback = await runFallbackWithDeadline(
      () => options.fallbackNormalizeRaster(raster, maximumOutputPixels),
      signal,
      deadlineAt,
      releaseFallbackRaster
    );
    try {
      return validateFallbackNormalizeResponse(fallback, maximumOutputPixels);
    } catch (error) {
      releaseFallbackRaster(fallback);
      throw error;
    }
  };

  const settleActive = (job: ActiveJob) => {
    clearTimeout(job.timeout);
    try {
      job.signal.removeEventListener("abort", job.abort);
    } catch {
      // A host-provided signal can disappear with its WebView. The job still relinquishes
      // processor ownership so a throwing cleanup hook cannot strand the single-flight gate.
    }
    if (active === job) active = null;
  };

  const disableWorker = (reason: unknown, permanently = true) => {
    if (permanently) workerUnavailable = true;
    epoch += 1;
    const retiredWorker = worker;
    const retiredWorkerFailureListener = workerFailureListener;
    workerFailureListener = null;
    if (retiredWorker) {
      try {
        retiredWorker.removeEventListener("message", onMessage);
      } catch {
        // Listener removal is best effort for injected and already-crashed workers.
      }
      if (retiredWorkerFailureListener) {
        try {
          retiredWorker.removeEventListener("error", retiredWorkerFailureListener);
        } catch {
          // The instance-bound listener cannot affect a replacement Worker even when retained.
        }
        try {
          retiredWorker.removeEventListener("messageerror", retiredWorkerFailureListener);
        } catch {
          // The instance-bound listener cannot affect a replacement Worker even when retained.
        }
      }
    }
    safeTerminate(retiredWorker);
    worker = null;
    const job = active;
    if (!job) return;
    settleActive(job);
    job.reject(reason);
  };

  function onMessage(event: MessageEvent<unknown>) {
    const record = plainRecord(event.data);
    const job = active;
    if (
      !record
      || !job
      || record.jobId !== job.id
      || record.epoch !== job.epoch
    ) return;
    settleActive(job);
    job.resolve(record);
  }
  const ensureWorker = (): StudioCompanionReferenceRasterWorkerLike | null => {
    if (released || workerUnavailable) return null;
    if (worker) return worker;
    let candidate: StudioCompanionReferenceRasterWorkerLike | null = null;
    let candidateFailureListener: ((event: Event) => void) | null = null;
    try {
      candidate = createWorker();
      const ownedCandidate = candidate;
      candidateFailureListener = () => {
        if (worker !== ownedCandidate || workerFailureListener !== candidateFailureListener) return;
        disableWorker(new Error("Reference raster worker failed"));
      };
      candidate.addEventListener("message", onMessage);
      candidate.addEventListener("error", candidateFailureListener);
      candidate.addEventListener("messageerror", candidateFailureListener);
      worker = candidate;
      workerFailureListener = candidateFailureListener;
      return candidate;
    } catch {
      workerUnavailable = true;
      worker = null;
      if (candidate) {
        try {
          candidate.removeEventListener("message", onMessage);
        } catch {
          // A partially initialized injected Worker is still terminated below.
        }
        if (candidateFailureListener) {
          try {
            candidate.removeEventListener("error", candidateFailureListener);
          } catch {
            // A partially initialized injected Worker is still terminated below.
          }
          try {
            candidate.removeEventListener("messageerror", candidateFailureListener);
          } catch {
            // A partially initialized injected Worker is still terminated below.
          }
        }
        safeTerminate(candidate);
      }
      return null;
    }
  };

  const runWorkerJob = async (
    kind: ActiveJob["kind"],
    payload: Record<string, unknown>,
    transfer: Transferable[],
    signal: AbortSignal,
    deadlineAt: number
  ): Promise<unknown | null> => {
    if (signal.aborted) throw abortError();
    const target = ensureWorker();
    if (!target || active) return null;
    const jobEpoch = epoch;
    const jobId = `reference-raster-${jobEpoch}-${++sequence}`;
    return new Promise((resolve, reject) => {
      // A normal demand cancellation retires only this worker instance. A later independent job
      // may lazily create a fresh worker; crashes, protocol violations, and timeouts still trip the
      // lifetime circuit breaker so a broken environment cannot spin workers indefinitely.
      let ownedJob: ActiveJob | null = null;
      const ownsActiveJob = () => active === ownedJob && epoch === jobEpoch;
      const abort = () => {
        if (!ownsActiveJob()) return;
        disableWorker(abortError(), false);
      };
      const timeout = setTimeout(() => {
        if (!ownsActiveJob()) return;
        disableWorker(timeoutError());
      }, Math.max(0, deadlineAt - now()));
      const job: ActiveJob = {
        epoch: jobEpoch,
        id: jobId,
        kind,
        resolve,
        reject,
        signal,
        abort,
        timeout,
      };
      ownedJob = job;
      active = job;
      try {
        signal.addEventListener("abort", abort, { once: true });
        // AbortSignal does not replay an abort that happened immediately before listener
        // registration. Recheck after ownership is installed and do not transfer input memory to
        // a Worker for a request whose demand has already ended.
        if (signal.aborted) {
          abort();
          return;
        }
        target.postMessage({
          ...payload,
          kind,
          jobId,
          epoch: jobEpoch,
          deadlineAt,
        }, transfer);
      } catch (error) {
        disableWorker(error);
      }
    });
  };

  const hashDataUrl = async (dataUrl: string, signal: AbortSignal): Promise<string> => {
    if (
      typeof dataUrl !== "string"
      || dataUrl.length < 1
      || dataUrl.length > STUDIO_COMPANION_REFERENCE_RASTER_WORKER_MAX_DATA_URL_CHARS
      || !/^data:/iu.test(dataUrl)
    ) throw new TypeError("Reference raster data URL is invalid or oversized");
    if (released || signal.aborted) throw abortError();
    const deadlineAt = now() + deadlineMs;
    try {
      const response = await runWorkerJob("hash", { dataUrl }, [], signal, deadlineAt);
      if (response !== null) {
        const jobError = workerJobError(response);
        if (jobError) disableWorker(jobError);
        const hash = validateHashResponse(response);
        if (hash) return hash;
        if (!jobError) disableWorker(new TypeError("Reference raster hash response is invalid"));
      }
    } catch (error) {
      if (
        released
        || signal.aborted
        || (error instanceof DOMException && error.name === "AbortError")
      ) throw error;
    }
    if (released || signal.aborted) throw abortError();
    return runFallbackWithDeadline(
      () => options.fallbackHashDataUrl(dataUrl),
      signal,
      deadlineAt
    );
  };

  const normalizeRaster = async (
    raster: StudioCompanionReferenceWorkerRaster,
    maximumOutputPixels: number,
    signal: AbortSignal
  ): Promise<StudioCompanionReferenceWorkerRaster | null> => {
    if (!validRasterInput(raster, maximumOutputPixels)) {
      throw new TypeError("Reference raster input is invalid or oversized");
    }
    if (released || signal.aborted) throw abortError();
    const deadlineAt = now() + deadlineMs;
    if (!ensureWorker() || active) {
      return runFallbackNormalize(raster, maximumOutputPixels, signal, deadlineAt);
    }
    const inputBuffer = raster.pixels.buffer;
    try {
      const response = await runWorkerJob(
        "normalize",
        {
          width: raster.width,
          height: raster.height,
          maximumOutputPixels,
          buffer: inputBuffer,
        },
        [inputBuffer],
        signal,
        deadlineAt
      );
      if (response === null) {
        return runFallbackNormalize(raster, maximumOutputPixels, signal, deadlineAt);
      }
      const jobError = workerJobError(response);
      if (jobError) {
        disableWorker(jobError);
        throw jobError;
      }
      const normalized = validateNormalizeResponse(response, maximumOutputPixels);
      if (!normalized) {
        disableWorker(new TypeError("Reference raster normalize response is invalid"));
        throw new TypeError("Reference raster normalize response is invalid");
      }
      return normalized;
    } catch (error) {
      if (
        released
        || signal.aborted
        || (error instanceof DOMException && error.name === "AbortError")
      ) throw error;
      // Once transferred, the source buffer is detached and cannot be used by the fallback safely.
      if (inputBuffer.byteLength === 0) throw error;
      return runFallbackNormalize(raster, maximumOutputPixels, signal, deadlineAt);
    }
  };

  const release = () => {
    if (released) return;
    released = true;
    processorController.abort();
    disableWorker(abortError("Reference raster processor released"));
  };

  return Object.freeze({ hashDataUrl, normalizeRaster, release });
}
