/// <reference lib="webworker" />

import { renderStudioBg3dLtLayers } from "./studio-bg3d-lt-render";
import {
  STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
  isStudioBg3dLtRenderWorkerRequest,
  studioBg3dLtRenderWorkerResponseTransfers,
  type StudioBg3dLtRenderWorkerResponse,
} from "./studio-bg3d-lt-render-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let consumed = false;

function requestIdFrom(value: unknown): number | null {
  try {
    if (typeof value !== "object" || value === null) return null;
    const requestId = Reflect.get(value, "requestId");
    return typeof requestId === "number" && Number.isSafeInteger(requestId) && requestId > 0
      ? requestId
      : null;
  } catch {
    return null;
  }
}

function post(response: StudioBg3dLtRenderWorkerResponse): void {
  scope.postMessage(response, studioBg3dLtRenderWorkerResponseTransfers(response));
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (consumed) return;
  consumed = true;
  const rawRequestId = requestIdFrom(event.data);
  if (!isStudioBg3dLtRenderWorkerRequest(event.data)) {
    if (rawRequestId !== null) {
      post({
        version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
        kind: "error",
        requestId: rawRequestId,
        code: "protocol",
      });
    }
    return;
  }

  const request = event.data;
  try {
    const result = renderStudioBg3dLtLayers({
      width: request.input.width,
      height: request.input.height,
      rgba: new Uint8Array(request.input.rgbaBuffer),
      ...(request.input.depthBuffer
        ? { depth: new Float32Array(request.input.depthBuffer) }
        : {}),
    }, request.settings);
    const response: StudioBg3dLtRenderWorkerResponse = {
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      width: result.width,
      height: result.height,
      layers: result.layers.map((layer) => ({
        role: layer.role,
        width: layer.width,
        height: layer.height,
        dataBuffer: layer.data.buffer as ArrayBuffer,
      })),
    };
    post(response);
  } catch {
    post({
      version: STUDIO_BG3D_LT_RENDER_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      code: "render-failed",
    });
  }
});

export {};
