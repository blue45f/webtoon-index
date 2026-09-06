/// <reference lib="webworker" />

import { buildStudioBg3dShotBatchArchive } from "./studio-bg3d-shot-batch";
import {
  STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotBatchWorkerRequest,
  type StudioBg3dShotBatchWorkerResponse,
} from "./studio-bg3d-shot-batch-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;

function post(response: StudioBg3dShotBatchWorkerResponse): void {
  scope.postMessage(response);
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const requestId = typeof event.data === "object" && event.data !== null &&
    Number.isSafeInteger((event.data as { requestId?: unknown }).requestId)
    ? (event.data as { requestId: number }).requestId
    : 1;
  if (!isStudioBg3dShotBatchWorkerRequest(event.data)) {
    post({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId,
      code: "protocol",
    });
    return;
  }
  const request = event.data;
  void buildStudioBg3dShotBatchArchive(request.images, {
    crc32ExecutionMode: "direct-headless",
    ...(request.manifest ? { manifest: request.manifest } : {}),
    ...(request.layeredPsds ? { layeredPsds: request.layeredPsds } : {}),
    ...(request.contactSheets ? { contactSheets: request.contactSheets } : {}),
    onProgress: (progress) => post({
      version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: request.requestId,
      progress,
    }),
  }).then((archive) => post({
    version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    archive,
  })).catch(() => post({
    version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
    kind: "error",
    requestId: request.requestId,
    code: "build-failed",
  }));
});

// This handshake distinguishes module construction/CSP/startup failures from failures in an
// admitted archive build. The client does not send caller-owned Blobs until this message arrives.
post({
  version: STUDIO_BG3D_SHOT_BATCH_WORKER_PROTOCOL_VERSION,
  kind: "ready",
});

export {};
