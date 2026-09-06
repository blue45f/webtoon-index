import {
  packStudioHybridDccGlbExportInput,
  unpackStudioHybridDccGlbExportInput,
} from "./studio-hybrid-dcc-glb-export-packed-mesh";
import {
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
  isStudioHybridDccGlbExportWorkerRequestEnvelope,
  isStudioHybridDccGlbExportWorkerResponse,
  studioHybridDccGlbExportWorkerRequestTransfers,
  type StudioHybridDccGlbExportWorkerItemResult,
  type StudioHybridDccGlbExportWorkerRequest,
} from "./studio-hybrid-dcc-glb-export-worker-protocol";

import type {
  StudioHybridDccMeshGlbExportInput,
  StudioHybridDccMeshGlbExportResult,
} from "./studio-hybrid-dcc-glb-export";
import type { StudioHybridDccPackedMeshManifest } from "./studio-hybrid-dcc-glb-export-packed-mesh";

export const STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_TIMEOUT_MS = 120_000;

interface WorkerMessageLike {
  readonly data: unknown;
}

interface WorkerErrorLike {
  preventDefault?(): void;
}

export interface StudioHybridDccGlbExportWorkerLike {
  postMessage(message: StudioHybridDccGlbExportWorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  addEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageLike) => void): void;
  removeEventListener(type: "error" | "messageerror", listener: (event: WorkerErrorLike) => void): void;
  terminate(): void;
}

export interface StudioHybridDccGlbExportBatchOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Selected once before export starts. Omission selects the product Worker. */
  readonly executionBackend?: StudioHybridDccGlbExportExecutionBackend;
  /** Test/integration seam for the already-selected Worker backend. */
  readonly workerFactory?: () => StudioHybridDccGlbExportWorkerLike | null;
}

export type StudioHybridDccGlbExportExecutionBackend = "worker" | "direct";

export interface StudioHybridDccGlbExportBatchOutcome {
  readonly execution: StudioHybridDccGlbExportExecutionBackend;
  readonly selectedExecutionBackend: StudioHybridDccGlbExportExecutionBackend;
  readonly attemptedExecutionBackends:
    readonly [StudioHybridDccGlbExportExecutionBackend];
  readonly results: readonly StudioHybridDccMeshGlbExportResult[];
}

export type StudioHybridDccGlbExportClientErrorCode =
  | "aborted"
  | "invalid-input"
  | "protocol"
  | "response-budget-exceeded"
  | "timeout"
  | "worker-failed"
  | "worker-unavailable";

export class StudioHybridDccGlbExportClientError extends Error {
  constructor(readonly code: StudioHybridDccGlbExportClientErrorCode) {
    super(`studio-hybrid-dcc-glb-export:${code}`);
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : code === "protocol" || code === "invalid-input" || code === "response-budget-exceeded"
          ? "ProtocolError"
          : code === "worker-unavailable"
            ? "WorkerUnavailableError"
            : "WorkerError";
  }
}

let nextRequestId = 1;

function takeRequestId(): number {
  const requestId = nextRequestId;
  nextRequestId = nextRequestId >= Number.MAX_SAFE_INTEGER ? 1 : nextRequestId + 1;
  return requestId;
}

function defaultWorkerFactory(): StudioHybridDccGlbExportWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-hybrid-dcc-glb-export.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-hybrid-dcc-glb-export",
  });
}

function boundedTimeout(value: number | undefined): number {
  if (!Number.isFinite(value)) return STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_TIMEOUT_MS;
  return Math.max(100, Math.min(300_000, Math.floor(value as number)));
}

function requestFor(
  requestId: number,
  inputs: readonly StudioHybridDccMeshGlbExportInput[],
): StudioHybridDccGlbExportWorkerRequest | null {
  try {
    const request: StudioHybridDccGlbExportWorkerRequest = {
      version: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
      kind: "export-batch",
      requestId,
      inputTransport: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_INPUT_TRANSPORT,
      payloads: inputs.map(packStudioHybridDccGlbExportInput),
      maxResponseBytes: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES,
    };
    return isStudioHybridDccGlbExportWorkerRequestEnvelope(request) ? request : null;
  } catch {
    return null;
  }
}

function hasMatchingProvenance(
  result: StudioHybridDccGlbExportWorkerItemResult,
  manifest: StudioHybridDccPackedMeshManifest,
): boolean {
  const source = result.report.source;
  if (
    source.assetId !== manifest.assetId
    || source.sourceRevision !== manifest.sourceRevision
    || source.sourceHash !== manifest.sourceHash
    || source.meshSchemaRevision !== manifest.meshRevision
  ) return false;
  if (!result.ok) return true;
  return result.metrics.sourceVertexCount === manifest.counts.vertices
    && result.metrics.sourceHalfEdgeCount === manifest.counts.halfEdges
    && result.metrics.sourceFaceCount === manifest.counts.faces;
}

function restoreResult(
  result: StudioHybridDccGlbExportWorkerItemResult,
): StudioHybridDccMeshGlbExportResult {
  if (!result.ok) return result;
  return {
    ...result,
    bytes: new Uint8Array(result.bytes),
  };
}

async function exportSynchronously(
  request: StudioHybridDccGlbExportWorkerRequest,
  signal: AbortSignal | undefined,
): Promise<readonly StudioHybridDccMeshGlbExportResult[]> {
  await Promise.resolve();
  if (signal?.aborted) throw new StudioHybridDccGlbExportClientError("aborted");
  const { exportStudioHybridDccMeshGlb } = await import("./studio-hybrid-dcc-glb-export");
  const results: StudioHybridDccMeshGlbExportResult[] = [];
  let totalByteLength = 0;
  for (const payload of request.payloads) {
    if (signal?.aborted) throw new StudioHybridDccGlbExportClientError("aborted");
    const input = unpackStudioHybridDccGlbExportInput(payload);
    if (!input) throw new StudioHybridDccGlbExportClientError("invalid-input");
    const result = exportStudioHybridDccMeshGlb(input);
    if (result.ok) {
      if (
        result.bytes.byteLength > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES - totalByteLength
      ) throw new StudioHybridDccGlbExportClientError("response-budget-exceeded");
      totalByteLength += result.bytes.byteLength;
    }
    results.push(result);
  }
  if (signal?.aborted) throw new StudioHybridDccGlbExportClientError("aborted");
  return results;
}

/**
 * Exports one worker-protocol window (≤ MAX_BATCH) from editable Geometry Authority inputs.
 *
 * The caller-selected backend remains authoritative for the entire window. Worker construction,
 * post, protocol, timeout, or runtime failure is terminal and never replays the export directly.
 */
function exportStudioHybridDccGlbBatchWindow(
  inputs: readonly StudioHybridDccMeshGlbExportInput[],
  options: StudioHybridDccGlbExportBatchOptions = {},
): Promise<readonly StudioHybridDccMeshGlbExportResult[]> {
  if (options.signal?.aborted) {
    return Promise.reject(new StudioHybridDccGlbExportClientError("aborted"));
  }
  if (inputs.length === 0) return Promise.resolve([]);
  if (inputs.length > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH) {
    return Promise.reject(new StudioHybridDccGlbExportClientError("invalid-input"));
  }
  const request = requestFor(takeRequestId(), inputs);
  if (!request) {
    return Promise.reject(new StudioHybridDccGlbExportClientError("invalid-input"));
  }
  if (options.executionBackend === "direct") {
    return exportSynchronously(request, options.signal);
  }

  return new Promise<readonly StudioHybridDccMeshGlbExportResult[]>((resolve, reject) => {
    let settled = false;
    let worker: StudioHybridDccGlbExportWorkerLike | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const safely = (callback: () => void) => {
      try {
        callback();
      } catch {
        // Host Worker shims cannot prevent deterministic cleanup and settlement.
      }
    };
    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      if (!worker) return;
      safely(() => worker?.removeEventListener("message", onMessage));
      safely(() => worker?.removeEventListener("error", onWorkerFailure));
      safely(() => worker?.removeEventListener("messageerror", onWorkerFailure));
      safely(() => worker?.terminate());
      worker = null;
    };
    const fail = (code: StudioHybridDccGlbExportClientErrorCode) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new StudioHybridDccGlbExportClientError(code));
    };
    const finish = (results: readonly StudioHybridDccMeshGlbExportResult[]) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(results);
    };
    const onAbort = () => fail("aborted");
    const onWorkerFailure = (event: WorkerErrorLike) => {
      event.preventDefault?.();
      fail("worker-failed");
    };
    const onMessage = (event: WorkerMessageLike) => {
      if (settled) return;
      if (!isStudioHybridDccGlbExportWorkerResponse(event.data)) {
        fail("protocol");
        return;
      }
      const response = event.data;
      if (response.requestId !== request.requestId) {
        fail("protocol");
        return;
      }
      if (response.kind === "error") {
        fail(
          response.code === "response-budget-exceeded"
            ? "response-budget-exceeded"
            : response.code === "protocol"
              ? "protocol"
              : "worker-failed",
        );
        return;
      }
      if (
        response.results.length !== request.payloads.length
        || response.results.some(
          (result, index) => !hasMatchingProvenance(result, request.payloads[index]!.manifest),
        )
      ) {
        fail("protocol");
        return;
      }
      finish(response.results.map(restoreResult));
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    try {
      worker = (options.workerFactory ?? defaultWorkerFactory)();
      if (
        !worker
        || typeof worker.postMessage !== "function"
        || typeof worker.addEventListener !== "function"
        || typeof worker.removeEventListener !== "function"
        || typeof worker.terminate !== "function"
      ) {
        fail("worker-unavailable");
        return;
      }
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onWorkerFailure);
      worker.addEventListener("messageerror", onWorkerFailure);
      timeout = setTimeout(() => fail("timeout"), boundedTimeout(options.timeoutMs));
      worker.postMessage(request, studioHybridDccGlbExportWorkerRequestTransfers(request));
    } catch {
      fail(worker ? "worker-failed" : "worker-unavailable");
    }
  });
}

/**
 * Exports a Geometry Authority mesh batch to GLB.
 *
 * Worker protocol windows stay ≤ {@link STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH}. Larger
 * product handoffs (classroom room presets + props) are chunked into sequential windows so the
 * BG3D attachment budget (256) is reachable without rejecting valid DCC scenes as `invalid-input`.
 */
export async function exportStudioHybridDccGlbBatch(
  inputs: readonly StudioHybridDccMeshGlbExportInput[],
  options: StudioHybridDccGlbExportBatchOptions = {},
): Promise<StudioHybridDccGlbExportBatchOutcome> {
  const executionBackend = options.executionBackend ?? "worker";
  if (executionBackend !== "worker" && executionBackend !== "direct") {
    throw new TypeError("studio-hybrid-dcc-glb-export:invalid-execution-backend");
  }
  const selectedOptions: StudioHybridDccGlbExportBatchOptions = {
    ...options,
    executionBackend,
  };
  if (options.signal?.aborted) {
    throw new StudioHybridDccGlbExportClientError("aborted");
  }
  if (inputs.length === 0) return exportOutcome(executionBackend, []);
  if (inputs.length <= STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH) {
    const results = await exportStudioHybridDccGlbBatchWindow(
      inputs,
      selectedOptions,
    );
    return exportOutcome(executionBackend, results);
  }

  const results: StudioHybridDccMeshGlbExportResult[] = [];
  for (
    let offset = 0;
    offset < inputs.length;
    offset += STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH
  ) {
    if (options.signal?.aborted) {
      throw new StudioHybridDccGlbExportClientError("aborted");
    }
    const windowInputs = inputs.slice(
      offset,
      offset + STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_BATCH,
    );
    const windowResults = await exportStudioHybridDccGlbBatchWindow(
      windowInputs,
      selectedOptions,
    );
    results.push(...windowResults);
  }
  return exportOutcome(executionBackend, results);
}

function exportOutcome(
  executionBackend: StudioHybridDccGlbExportExecutionBackend,
  results: readonly StudioHybridDccMeshGlbExportResult[],
): StudioHybridDccGlbExportBatchOutcome {
  return Object.freeze({
    execution: executionBackend,
    selectedExecutionBackend: executionBackend,
    attemptedExecutionBackends: Object.freeze([
      executionBackend,
    ]) as readonly [StudioHybridDccGlbExportExecutionBackend],
    results: Object.freeze([...results]),
  });
}
