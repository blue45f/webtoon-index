/// <reference lib="webworker" />

import { buildStudioBg3dShotContactSheets } from "./studio-bg3d-shot-contact-sheet";
import {
  STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotContactSheetWorkerRequest,
  type StudioBg3dShotContactSheetWorkerResponse,
} from "./studio-bg3d-shot-contact-sheet-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;

function post(response: StudioBg3dShotContactSheetWorkerResponse): void {
  scope.postMessage(response);
}

function responseRequestId(value: unknown): number {
  if (typeof value !== "object" || value === null) return 1;
  const requestId = (value as { readonly requestId?: unknown }).requestId;
  return Number.isSafeInteger(requestId) && (requestId as number) > 0 ? requestId as number : 1;
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const requestId = responseRequestId(event.data);
  if (!isStudioBg3dShotContactSheetWorkerRequest(event.data)) {
    post({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId,
      code: "protocol",
    });
    return;
  }
  const request = event.data;
  void buildStudioBg3dShotContactSheets(request.images, {
    layout: request.layout,
    onProgress: (progress) => post({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "progress",
      requestId: request.requestId,
      progress,
    }),
  }).then((result) => post({
    version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
    kind: "result",
    requestId: request.requestId,
    result,
  })).catch((error: unknown) => {
    const code = error instanceof Error && error.name === "NotSupportedError"
      ? "unsupported-runtime"
      : error instanceof TypeError || error instanceof RangeError
        ? "protocol"
        : "build-failed";
    post({
      version: STUDIO_BG3D_SHOT_CONTACT_SHEET_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      code,
    });
  });
});

export {};
