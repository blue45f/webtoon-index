import { decodeStudioRasterInterchange, encodeStudioRasterInterchange } from "./studio-raster-interchange";
import {
  STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
  studioRasterInterchangeResponseTransfers,
  type StudioRasterInterchangeWorkerRequest,
  type StudioRasterInterchangeWorkerResponse,
} from "./studio-raster-interchange-worker-protocol";

interface WorkerScope {
  onmessage: ((event: MessageEvent<StudioRasterInterchangeWorkerRequest>) => void) | null;
  postMessage(message: StudioRasterInterchangeWorkerResponse, transfers: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.postMessage({
  type: "studio-raster-interchange/ready",
  version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
}, []);

scope.onmessage = (event) => {
  const request = event.data;
  if (
    !request || (
      request.type !== "studio-raster-interchange/encode"
      && request.type !== "studio-raster-interchange/decode"
    ) ||
    request.version !== STUDIO_RASTER_INTERCHANGE_WORKER_VERSION
  ) return;
  let response: StudioRasterInterchangeWorkerResponse;
  try {
    if (request.type === "studio-raster-interchange/encode") {
      const result = encodeStudioRasterInterchange(request.format, {
        width: request.width,
        height: request.height,
        data: request.data,
      });
      response = {
        type: "studio-raster-interchange/encode-success",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: request.requestId,
        result,
      };
    } else {
      response = {
        type: "studio-raster-interchange/decode-success",
        version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
        requestId: request.requestId,
        result: decodeStudioRasterInterchange(request.bytes, request.expectedFormat),
      };
    }
  } catch (error) {
    response = {
      type: "studio-raster-interchange/failure",
      version: STUDIO_RASTER_INTERCHANGE_WORKER_VERSION,
      requestId: request.requestId,
      error: {
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : "래스터 Worker 작업에 실패했습니다.",
      },
    };
  }
  scope.postMessage(response, studioRasterInterchangeResponseTransfers(response));
};
