/// <reference lib="webworker" />

import { buildStudioBg3dShotLayeredPsd } from "./studio-bg3d-shot-psd";
import {
  STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotPsdWorkerRequest,
  type StudioBg3dShotPsdWorkerResponse,
} from "./studio-bg3d-shot-psd-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
const post = (response: StudioBg3dShotPsdWorkerResponse) => scope.postMessage(response);

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const requestId = typeof event.data === "object" && event.data !== null &&
    Number.isSafeInteger((event.data as { requestId?: unknown }).requestId)
    ? (event.data as { requestId: number }).requestId
    : 1;
  if (!isStudioBg3dShotPsdWorkerRequest(event.data)) {
    post({
      version: STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId,
      code: "protocol",
    });
    return;
  }
  try {
    post({
      version: STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: event.data.requestId,
      psd: buildStudioBg3dShotLayeredPsd(event.data.layers),
    });
  } catch {
    post({
      version: STUDIO_BG3D_SHOT_PSD_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: event.data.requestId,
      code: "build-failed",
    });
  }
});

export {};
