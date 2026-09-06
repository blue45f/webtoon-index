/// <reference lib="webworker" />

import {
  STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES,
  STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
  isStudioBg3dShotPngWorkerRequest,
  type StudioBg3dShotPngWorkerRequest,
  type StudioBg3dShotPngWorkerResponse,
} from "./studio-bg3d-shot-png-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
let consumed = false;

function post(response: StudioBg3dShotPngWorkerResponse): void {
  scope.postMessage(response);
}

function requestIdFrom(value: unknown): number {
  try {
    if (typeof value !== "object" || value === null) return 1;
    const requestId = Reflect.get(value, "requestId");
    return typeof requestId === "number" && Number.isSafeInteger(requestId) && requestId > 0
      ? requestId
      : 1;
  } catch {
    return 1;
  }
}

function supportsOffscreenCanvas2d(): boolean {
  try {
    if (typeof OffscreenCanvas !== "function") return false;
    const canvas = new OffscreenCanvas(1, 1);
    const context = canvas.getContext("2d");
    const supported = context !== null && typeof canvas.convertToBlob === "function";
    canvas.width = 1;
    canvas.height = 1;
    return supported;
  } catch {
    return false;
  }
}

async function encodePng(request: StudioBg3dShotPngWorkerRequest): Promise<Blob> {
  const compositeCanvas = new OffscreenCanvas(request.width, request.height);
  const layerCanvas = new OffscreenCanvas(request.width, request.height);
  try {
    const compositeContext = compositeCanvas.getContext("2d");
    const layerContext = layerCanvas.getContext("2d");
    if (!compositeContext || !layerContext) throw new Error("2D context unavailable");

    for (const layer of request.layers) {
      layerContext.clearRect(0, 0, request.width, request.height);
      const imageData = layerContext.createImageData(request.width, request.height);
      imageData.data.set(new Uint8ClampedArray(layer.dataBuffer));
      layerContext.putImageData(imageData, 0, 0);
      compositeContext.drawImage(layerCanvas, 0, 0);
    }
    const png = await compositeCanvas.convertToBlob({ type: "image/png" });
    if (
      png.type !== "image/png" || png.size < 24 ||
      png.size > STUDIO_BG3D_SHOT_PNG_WORKER_MAX_OUTPUT_BYTES
    ) throw new Error("invalid PNG result");
    return png;
  } finally {
    layerCanvas.width = 1;
    layerCanvas.height = 1;
    compositeCanvas.width = 1;
    compositeCanvas.height = 1;
  }
}

if (!supportsOffscreenCanvas2d()) {
  post({
    version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
    kind: "unavailable",
    code: "offscreen-canvas",
  });
} else {
  scope.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (consumed) return;
    consumed = true;
    const requestId = requestIdFrom(event.data);
    if (!isStudioBg3dShotPngWorkerRequest(event.data)) {
      post({
        version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
        kind: "error",
        requestId,
        code: "protocol",
      });
      return;
    }
    const request = event.data;
    void encodePng(request).then((png) => post({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      width: request.width,
      height: request.height,
      png,
    })).catch(() => post({
      version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      code: "encode-failed",
    }));
  });

  post({
    version: STUDIO_BG3D_SHOT_PNG_WORKER_PROTOCOL_VERSION,
    kind: "ready",
  });
}

export {};
