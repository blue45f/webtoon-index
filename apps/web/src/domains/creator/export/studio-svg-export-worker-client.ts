import { serializeStudioBrushR8TextureGrainSourceCanonical } from "../brush/studio-brush-r8-grain-asset-contract";
import { snapshotStudioBrushR8GrainAssetsForTransfer } from "../brush/studio-brush-r8-grain-runtime";
import { loadStudioPerfectFreehandStroker } from "../studio-perfect-freehand";

import { exportPageToSvg, type SvgExportPageInput, type SvgExportResult } from "./studio-svg-export";
import {
  collectStudioSvgExportReferencedR8GrainSources,
  STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
  STUDIO_SVG_EXPORT_WORKER_R8_TRANSFER_LIMITS,
  type StudioSvgExportWorkerR8GrainEntry,
  type StudioSvgExportWorkerResponseMessage,
  type StudioSvgExportWorkerRunMessage,
} from "./studio-svg-export-worker-protocol";

export interface StudioSvgExportWorkerLike {
  onmessage: ((event: MessageEvent<StudioSvgExportWorkerResponseMessage>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  postMessage(message: StudioSvgExportWorkerRunMessage, transfer: ArrayBuffer[]): void;
  terminate(): void;
}

export type StudioSvgExportWorkerFactory = () => StudioSvgExportWorkerLike | null;

export interface StudioSvgExportWorkerClientOptions {
  signal?: AbortSignal;
  /** Selected exactly once before the export starts. Omission selects the product Worker. */
  executionBackend?: "worker" | "direct";
  /** Test/runtime seam. A null/throwing factory makes the selected Worker unavailable. */
  workerFactory?: StudioSvgExportWorkerFactory | null;
  /** Product default is 30 seconds; injectable only to keep timeout tests deterministic. */
  runTimeoutMs?: number;
}

export interface StudioSvgExportWorkerClientResult {
  execution: "worker" | "direct";
  result: SvgExportResult;
}

const STUDIO_SVG_EXPORT_PREWARM_IDLE_MS = 45_000;
const STUDIO_SVG_EXPORT_READY_TIMEOUT_MS = 3_000;
const STUDIO_SVG_EXPORT_RUN_TIMEOUT_MS = 30_000;

interface StudioSvgExportPrewarmedWorker {
  readonly worker: StudioSvgExportWorkerLike;
  ready: boolean;
  readyTimer: ReturnType<typeof setTimeout> | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

let prewarmedStudioSvgExportWorker: StudioSvgExportPrewarmedWorker | null = null;

export interface StudioSvgExportWorkerR8Transfer {
  readonly entries: readonly Readonly<StudioSvgExportWorkerR8GrainEntry>[];
  readonly buffers: ArrayBuffer[];
}

function isPrivateExactUint8Array(value: unknown): value is Uint8Array<ArrayBuffer> {
  return (
    value instanceof Uint8Array
    && Object.getPrototypeOf(value) === Uint8Array.prototype
    && value.buffer instanceof ArrayBuffer
    && value.byteOffset === 0
    && value.byteLength === value.buffer.byteLength
  );
}

function zeroizeStudioSvgExportWorkerR8Transfer(
  transfer: StudioSvgExportWorkerR8Transfer,
): void {
  for (const entry of transfer.entries) {
    try {
      if (isPrivateExactUint8Array(entry.decodedBytes)) entry.decodedBytes.fill(0);
    } catch {
      // A successful postMessage detaches the private buffer. Detached views are already cleared
      // from this realm and some engines throw when their properties are inspected.
    }
  }
}

/**
 * Produces an export-private, bounded transfer set. The runtime snapshot API copies verified bytes;
 * this second boundary ensures that only sources referenced by this export cross into the worker.
 */
export function prepareStudioSvgExportWorkerR8Transfer(
  input: SvgExportPageInput,
): StudioSvgExportWorkerR8Transfer {
  const referenced = collectStudioSvgExportReferencedR8GrainSources(input);
  const referencedKeys = new Set(referenced.map((entry) => entry.sourceKey));
  const snapshot = snapshotStudioBrushR8GrainAssetsForTransfer(
    referenced.map((entry) => entry.source),
  );
  const entries: Readonly<StudioSvgExportWorkerR8GrainEntry>[] = [];
  const buffers: ArrayBuffer[] = [];
  const admittedKeys = new Set<string>();
  let totalDecodedBytes = 0;

  for (const candidate of snapshot.entries) {
    const bytes = candidate.decodedBytes;
    const nextTotal = totalDecodedBytes + bytes.byteLength;
    const admissible = (
      referencedKeys.has(candidate.sourceKey)
      && !admittedKeys.has(candidate.sourceKey)
      && serializeStudioBrushR8TextureGrainSourceCanonical(candidate.source)
        === candidate.sourceKey
      && isPrivateExactUint8Array(bytes)
      && candidate.source.asset.width * candidate.source.asset.height === bytes.byteLength
      && entries.length < STUDIO_SVG_EXPORT_WORKER_R8_TRANSFER_LIMITS.maxEntries
      && Number.isSafeInteger(nextTotal)
      && nextTotal <= STUDIO_SVG_EXPORT_WORKER_R8_TRANSFER_LIMITS.maxDecodedBytes
    );
    if (!admissible) {
      try {
        if (isPrivateExactUint8Array(bytes)) bytes.fill(0);
      } catch {
        // The runtime promises private attached copies; keep this boundary fail-closed regardless.
      }
      continue;
    }
    const entry = Object.freeze({
      sourceKey: candidate.sourceKey,
      source: candidate.source,
      decodedBytes: bytes,
    });
    admittedKeys.add(candidate.sourceKey);
    totalDecodedBytes = nextTotal;
    entries.push(entry);
    buffers.push(bytes.buffer);
  }

  if (
    snapshot.totalDecodedBytes !== totalDecodedBytes
    || snapshot.entries.length !== entries.length
  ) {
    zeroizeStudioSvgExportWorkerR8Transfer({ entries, buffers });
    return Object.freeze({ entries: Object.freeze([]), buffers: [] });
  }

  return Object.freeze({
    entries: Object.freeze(entries),
    buffers,
  });
}

/** Vite statically discovers this exact URL pattern and emits an isolated module-worker chunk. */
export function createStudioSvgExportModuleWorker(): StudioSvgExportWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-svg-export.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-svg-export",
  }) as unknown as StudioSvgExportWorkerLike;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isStudioSvgExportWorkerResponseMessage(
  value: unknown,
): value is StudioSvgExportWorkerResponseMessage {
  if (
    !isRecord(value)
    || value.version !== STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION
    || typeof value.type !== "string"
  ) return false;
  if (value.type === "studio-svg-export/ready") return true;
  if (value.type === "studio-svg-export/failure") {
    return isRecord(value.error)
      && typeof value.error.name === "string"
      && typeof value.error.message === "string";
  }
  if (value.type !== "studio-svg-export/success" || !isRecord(value.result)) return false;
  const result = value.result;
  return (
    typeof result.svg === "string"
    && Array.isArray(result.skipped)
    && result.skipped.every((entry) =>
      isRecord(entry)
      && typeof entry.id === "string"
      && typeof entry.type === "string"
      && (entry.mode === "skipped" || entry.mode === "approximated")
      && typeof entry.label === "string"
    )
    && isStringArray(result.fontFamilies)
    && isStringArray(result.caveats)
    && Number.isSafeInteger(result.elementCount)
    && Number(result.elementCount) >= 0
  );
}

function boundedStudioSvgExportRunTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_SVG_EXPORT_RUN_TIMEOUT_MS;
  return Math.max(100, Math.min(120_000, Math.floor(value as number)));
}

function clearStudioSvgExportPrewarmIdleTimer(
  entry: StudioSvgExportPrewarmedWorker,
): void {
  if (entry.idleTimer === null) return;
  clearTimeout(entry.idleTimer);
  entry.idleTimer = null;
}

function clearStudioSvgExportPrewarmReadyTimer(
  entry: StudioSvgExportPrewarmedWorker,
): void {
  if (entry.readyTimer === null) return;
  clearTimeout(entry.readyTimer);
  entry.readyTimer = null;
}

function releaseStudioSvgExportPrewarmedWorker(
  entry = prewarmedStudioSvgExportWorker,
): void {
  if (!entry) return;
  if (prewarmedStudioSvgExportWorker === entry) {
    prewarmedStudioSvgExportWorker = null;
  }
  clearStudioSvgExportPrewarmReadyTimer(entry);
  clearStudioSvgExportPrewarmIdleTimer(entry);
  entry.worker.onmessage = null;
  entry.worker.onerror = null;
  entry.worker.terminate();
}

/** Releases an unused intent-warmed Worker on route/HMR teardown and in deterministic tests. */
export function disposeStudioSvgExportPrewarmedWorker(): void {
  releaseStudioSvgExportPrewarmedWorker();
}

/**
 * Starts the exact production SVG Worker without sending document data.
 *
 * The Worker announces readiness only after its outline engine has loaded, so a hover/focus hint
 * can hide module startup while keeping the first real export byte-identical. The lease is
 * one-shot: the next production run takes ownership and retains the existing terminate-on-settle
 * lifecycle; an unused worker is released after a short idle window.
 */
export function preloadStudioSvgExportWorker(
  workerFactory: StudioSvgExportWorkerFactory = createStudioSvgExportModuleWorker,
): boolean {
  if (prewarmedStudioSvgExportWorker) {
    const entry = prewarmedStudioSvgExportWorker;
    clearStudioSvgExportPrewarmIdleTimer(entry);
    entry.idleTimer = setTimeout(() => {
      releaseStudioSvgExportPrewarmedWorker(entry);
    }, STUDIO_SVG_EXPORT_PREWARM_IDLE_MS);
    return true;
  }
  let worker: StudioSvgExportWorkerLike | null;
  try {
    worker = workerFactory();
  } catch {
    return false;
  }
  if (!worker) return false;

  const entry: StudioSvgExportPrewarmedWorker = {
    worker,
    ready: false,
    readyTimer: null,
    idleTimer: null,
  };
  prewarmedStudioSvgExportWorker = entry;
  worker.onmessage = (event) => {
    if (prewarmedStudioSvgExportWorker !== entry) return;
    const response = event.data;
    if (
      !isStudioSvgExportWorkerResponseMessage(response)
      || response.type !== "studio-svg-export/ready"
    ) {
      releaseStudioSvgExportPrewarmedWorker(entry);
      return;
    }
    clearStudioSvgExportPrewarmReadyTimer(entry);
    entry.ready = true;
  };
  worker.onerror = (event) => {
    event.preventDefault?.();
    releaseStudioSvgExportPrewarmedWorker(entry);
  };
  entry.idleTimer = setTimeout(() => {
    releaseStudioSvgExportPrewarmedWorker(entry);
  }, STUDIO_SVG_EXPORT_PREWARM_IDLE_MS);
  entry.readyTimer = setTimeout(() => {
    releaseStudioSvgExportPrewarmedWorker(entry);
  }, STUDIO_SVG_EXPORT_READY_TIMEOUT_MS);
  return true;
}

function takeStudioSvgExportPrewarmedWorker(): {
  readonly worker: StudioSvgExportWorkerLike;
  readonly ready: boolean;
} | null {
  const entry = prewarmedStudioSvgExportWorker;
  if (!entry) return null;
  prewarmedStudioSvgExportWorker = null;
  clearStudioSvgExportPrewarmReadyTimer(entry);
  clearStudioSvgExportPrewarmIdleTimer(entry);
  entry.worker.onmessage = null;
  entry.worker.onerror = null;
  return { worker: entry.worker, ready: entry.ready };
}

if (import.meta.hot) {
  import.meta.hot.dispose(disposeStudioSvgExportPrewarmedWorker);
}

function createAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("SVG 내보내기를 취소했습니다.", "AbortError");
  }
  const error = new Error("SVG 내보내기를 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

export async function runStudioSvgExportDirect(
  input: SvgExportPageInput,
  signal: AbortSignal | undefined,
): Promise<StudioSvgExportWorkerClientResult> {
  throwIfAborted(signal);
  // Match the short-lived module worker so explicitly selected direct exports retain outline parity.
  await loadStudioPerfectFreehandStroker();
  throwIfAborted(signal);
  return { execution: "direct", result: exportPageToSvg(input) };
}

function deserializeWorkerError(response: Extract<
  StudioSvgExportWorkerResponseMessage,
  { type: "studio-svg-export/failure" }
>): Error {
  const error = new Error(response.error.message);
  error.name = response.error.name || "Error";
  return error;
}

function runSvgExportWithWorker(
  worker: StudioSvgExportWorkerLike,
  input: SvgExportPageInput,
  signal: AbortSignal | undefined,
  r8Transfer: StudioSvgExportWorkerR8Transfer,
  workerAlreadyReady = false,
  runTimeoutMs = STUDIO_SVG_EXPORT_RUN_TIMEOUT_MS,
): Promise<StudioSvgExportWorkerClientResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let requestPosted = false;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    let runTimer: ReturnType<typeof setTimeout> | null = null;
    const message: StudioSvgExportWorkerRunMessage = {
      type: "studio-svg-export/run",
      version: STUDIO_SVG_EXPORT_WORKER_PROTOCOL_VERSION,
      input,
      r8GrainAssets: r8Transfer.entries,
    };

    const cleanup = () => {
      if (readyTimer !== null) clearTimeout(readyTimer);
      if (runTimer !== null) clearTimeout(runTimer);
      signal?.removeEventListener("abort", onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      zeroizeStudioSvgExportWorkerR8Transfer(r8Transfer);
    };
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));
    const postRequest = () => {
      requestPosted = true;
      runTimer = setTimeout(() => {
        finish(() => reject(new Error("SVG 내보내기 Worker 계산 시간이 초과되었습니다.")));
      }, runTimeoutMs);
      try {
        worker.postMessage(message, r8Transfer.buffers);
      } catch (cause) {
        requestPosted = false;
        finish(() => reject(new Error(
          "SVG 내보내기 Worker에 요청을 전달하지 못했습니다.",
          { cause },
        )));
      }
    };

    worker.onmessage = (event) => {
      const response = event.data;
      if (!isStudioSvgExportWorkerResponseMessage(response)) {
        finish(() => reject(new Error("SVG 내보내기 Worker가 알 수 없는 응답을 반환했습니다.")));
        return;
      }
      if (response.type === "studio-svg-export/ready") {
        if (requestPosted) return;
        if (readyTimer !== null) {
          clearTimeout(readyTimer);
          readyTimer = null;
        }
        postRequest();
        return;
      }
      if (!requestPosted) {
        finish(() => reject(new Error("SVG 내보내기 Worker가 준비 전에 결과를 반환했습니다.")));
        return;
      }
      if (response.type === "studio-svg-export/failure") {
        finish(() => reject(deserializeWorkerError(response)));
        return;
      }
      finish(() => resolve({ execution: "worker", result: response.result }));
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || "SVG 내보내기 Worker 실행 중 오류가 발생했습니다.");
      finish(() => reject(error));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    if (workerAlreadyReady) {
      postRequest();
    } else {
      readyTimer = setTimeout(() => finish(() => reject(
        new Error("SVG 내보내기 Worker 준비 시간이 초과되었습니다."),
      )), STUDIO_SVG_EXPORT_READY_TIMEOUT_MS);
    }
  });
}

/**
 * 벡터 SVG 직렬화 백엔드를 작업 전에 한 번 선택한다. 제품 기본은 모듈 Worker이며,
 * Worker 생성/준비/전송/실행 실패는 모두 terminal이다. Direct 실행은 명시적인 mode에서만
 * 가능하고, 시작된 Worker 요청을 main realm에서 재실행하지 않는다.
 */
export async function runStudioSvgExportWorker(
  input: SvgExportPageInput,
  options: StudioSvgExportWorkerClientOptions = {},
): Promise<StudioSvgExportWorkerClientResult> {
  throwIfAborted(options.signal);
  const executionBackend = options.executionBackend ?? "worker";
  if (executionBackend !== "worker" && executionBackend !== "direct") {
    throw new TypeError("SVG 내보내기 실행 백엔드가 올바르지 않습니다.");
  }
  if (executionBackend === "direct") {
    return runStudioSvgExportDirect(input, options.signal);
  }
  const prewarmed = options.workerFactory === undefined
    ? takeStudioSvgExportPrewarmedWorker()
    : null;
  const factory =
    options.workerFactory === undefined ? createStudioSvgExportModuleWorker : options.workerFactory;
  if (!factory && !prewarmed) {
    throw new Error("SVG 내보내기 Worker를 사용할 수 없습니다.");
  }

  let worker: StudioSvgExportWorkerLike | null;
  if (prewarmed) {
    worker = prewarmed.worker;
  } else {
    try {
      worker = factory?.() ?? null;
    } catch (cause) {
      throw new Error("SVG 내보내기 Worker를 생성하지 못했습니다.", { cause });
    }
  }
  if (!worker) throw new Error("SVG 내보내기 Worker를 사용할 수 없습니다.");
  let r8Transfer: StudioSvgExportWorkerR8Transfer;
  try {
    r8Transfer = prepareStudioSvgExportWorkerR8Transfer(input);
  } catch (cause) {
    worker.terminate();
    throw cause;
  }
  return runSvgExportWithWorker(
    worker,
    input,
    options.signal,
    r8Transfer,
    prewarmed?.ready ?? false,
    boundedStudioSvgExportRunTimeout(options.runTimeoutMs),
  );
}
