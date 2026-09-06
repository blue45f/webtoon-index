/// <reference lib="webworker" />

import {
  StudioAbrImportError,
  parseStudioAbrBuffer,
} from "./studio-abr-import";
import {
  STUDIO_ABR_WORKER_PROTOCOL_VERSION,
  type StudioAbrWorkerRequest,
  type StudioAbrWorkerResponse,
} from "./studio-abr-import-worker-protocol";

function validRequest(value: unknown): value is StudioAbrWorkerRequest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.version === STUDIO_ABR_WORKER_PROTOCOL_VERSION
    && typeof record.requestId === "number"
    && Number.isSafeInteger(record.requestId)
    && record.requestId > 0
    && record.bytes instanceof ArrayBuffer;
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!validRequest(request)) return;
  void parseStudioAbrBuffer(request.bytes).then(
    (result) => {
      const response: StudioAbrWorkerResponse = {
        version: STUDIO_ABR_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        result,
      };
      workerScope.postMessage(response);
    },
    (error: unknown) => {
      const response: StudioAbrWorkerResponse = {
        version: STUDIO_ABR_WORKER_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: false,
        code: error instanceof StudioAbrImportError ? error.code : "parse",
      };
      workerScope.postMessage(response);
    }
  );
});

export {};
