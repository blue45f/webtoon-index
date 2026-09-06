/// <reference lib="webworker" />

import { exportStudioHybridDccMeshGlb } from "./studio-hybrid-dcc-glb-export";
import { unpackStudioHybridDccGlbExportInput } from "./studio-hybrid-dcc-glb-export-packed-mesh";
import {
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES,
  STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
  isStudioHybridDccGlbExportWorkerRequestEnvelope,
  isStudioHybridDccGlbExportWorkerResponse,
  studioHybridDccGlbExportWorkerResponseTransfers,
  type StudioHybridDccGlbExportWorkerErrorCode,
  type StudioHybridDccGlbExportWorkerItemResult,
  type StudioHybridDccGlbExportWorkerRequest,
  type StudioHybridDccGlbExportWorkerResponse,
} from "./studio-hybrid-dcc-glb-export-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let handled = false;

function requestIdFrom(value: unknown): number {
  if (typeof value !== "object" || value === null) return 1;
  const requestId = (value as { readonly requestId?: unknown }).requestId;
  return typeof requestId === "number" && Number.isSafeInteger(requestId) && requestId > 0
    ? requestId
    : 1;
}

function postError(requestId: number, code: StudioHybridDccGlbExportWorkerErrorCode): void {
  const response: StudioHybridDccGlbExportWorkerResponse = {
    version: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
    kind: "error",
    requestId,
    code,
  };
  scope.postMessage(response);
}

function execute(request: StudioHybridDccGlbExportWorkerRequest): void {
  const results: StudioHybridDccGlbExportWorkerItemResult[] = [];
  let totalByteLength = 0;
  for (const payload of request.payloads) {
    const input = unpackStudioHybridDccGlbExportInput(payload);
    if (!input) {
      postError(request.requestId, "protocol");
      return;
    }
    const result = exportStudioHybridDccMeshGlb(input);
    if (!result.ok) {
      results.push(result);
      continue;
    }
    if (
      result.bytes.byteLength > request.maxResponseBytes - totalByteLength
      || result.bytes.byteLength > STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_MAX_RESPONSE_BYTES
    ) {
      postError(request.requestId, "response-budget-exceeded");
      return;
    }
    totalByteLength += result.bytes.byteLength;
    results.push({
      ...result,
      bytes: result.bytes.buffer,
    });
  }
  const response: StudioHybridDccGlbExportWorkerResponse = {
    version: STUDIO_HYBRID_DCC_GLB_EXPORT_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    results,
    totalByteLength,
  };
  if (!isStudioHybridDccGlbExportWorkerResponse(response)) {
    postError(request.requestId, "protocol");
    return;
  }
  scope.postMessage(response, studioHybridDccGlbExportWorkerResponseTransfers(response));
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const requestId = requestIdFrom(event.data);
  if (handled || !isStudioHybridDccGlbExportWorkerRequestEnvelope(event.data)) {
    postError(requestId, "protocol");
    return;
  }
  handled = true;
  try {
    execute(event.data);
  } catch {
    postError(requestId, "export-failed");
  }
});

export {};
