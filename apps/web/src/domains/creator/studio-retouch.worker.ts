import {
  STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION,
  studioRetouchSuccessTransfers,
  type StudioRetouchWorkerFailureMessage,
  type StudioRetouchWorkerResponseMessage,
  type StudioRetouchWorkerRunMessage,
  type StudioRetouchWorkerSuccessMessage,
} from "./studio-retouch-worker-protocol";
import { applyStudioRetouchWorkerRequest } from "./studio-retouch-worker-runtime";

interface StudioRetouchWorkerScope {
  onmessage: ((event: MessageEvent<StudioRetouchWorkerRunMessage>) => void) | null;
  postMessage(message: StudioRetouchWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioRetouchWorkerScope;

workerScope.postMessage({
  type: "studio-retouch/ready",
  version: STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioRetouchWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "리터치 Worker 실행에 실패했습니다.",
    };
  }
  return { name: "Error", message: "리터치 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    !message
    || typeof message !== "object"
    || message.type !== "studio-retouch/run"
    || message.version !== STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION
  ) return;

  try {
    const result = applyStudioRetouchWorkerRequest(message.request);
    const response: StudioRetouchWorkerSuccessMessage = {
      type: "studio-retouch/success",
      version: STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION,
      ...result,
    };
    workerScope.postMessage(response, studioRetouchSuccessTransfers(response));
  } catch (error) {
    const response: StudioRetouchWorkerFailureMessage = {
      type: "studio-retouch/failure",
      version: STUDIO_RETOUCH_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
