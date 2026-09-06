import { parseStudioCrdtRasterDocumentRoots } from "../../../shared/lib/studio-crdt-raster-document-contract";

import {
  STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION,
  type StudioCrdtRasterWorkerFailureMessage,
  type StudioCrdtRasterWorkerResponseMessage,
  type StudioCrdtRasterWorkerRunMessage,
  type StudioCrdtRasterWorkerSuccessMessage,
} from "./studio-crdt-raster-worker-protocol";

interface StudioCrdtRasterWorkerScope {
  onmessage: ((event: MessageEvent<StudioCrdtRasterWorkerRunMessage>) => void) | null;
  postMessage(message: StudioCrdtRasterWorkerResponseMessage): void;
}

const workerScope = globalThis as unknown as StudioCrdtRasterWorkerScope;

workerScope.postMessage({
  type: "studio-crdt-raster/ready",
  version: STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION,
});

function serializeWorkerError(error: unknown): StudioCrdtRasterWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || "래스터 문서 파싱 Worker 실행에 실패했습니다." };
  }
  return { name: "Error", message: "래스터 문서 파싱 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    message.type !== "studio-crdt-raster/run" ||
    message.version !== STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    const snapshot = parseStudioCrdtRasterDocumentRoots(message.roots);
    const response: StudioCrdtRasterWorkerSuccessMessage = {
      type: "studio-crdt-raster/success",
      version: STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION,
      snapshot,
    };
    workerScope.postMessage(response);
  } catch (error) {
    const response: StudioCrdtRasterWorkerFailureMessage = {
      type: "studio-crdt-raster/failure",
      version: STUDIO_CRDT_RASTER_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response);
  }
};
