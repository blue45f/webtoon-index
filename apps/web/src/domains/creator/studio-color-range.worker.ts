import {
  STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION,
  type StudioColorRangeWorkerFailureMessage,
  type StudioColorRangeWorkerResponseMessage,
  type StudioColorRangeWorkerRunMessage,
  type StudioColorRangeWorkerSuccessMessage,
} from "./studio-color-range-worker-protocol";
import { executeStudioColorRangeWorkerRequest } from "./studio-color-range-worker-runtime";

interface StudioColorRangeWorkerScope {
  onmessage: ((event: MessageEvent<StudioColorRangeWorkerRunMessage>) => void) | null;
  postMessage(message: StudioColorRangeWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioColorRangeWorkerScope;

workerScope.postMessage({
  type: "studio-color-range/ready",
  version: STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioColorRangeWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "색상 범위 Worker 실행에 실패했습니다.",
    };
  }
  return { name: "Error", message: "색상 범위 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    message.type !== "studio-color-range/run"
    || message.version !== STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    const response: StudioColorRangeWorkerSuccessMessage = {
      type: "studio-color-range/success",
      version: STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      selection: executeStudioColorRangeWorkerRequest(message.request),
    };
    workerScope.postMessage(response, []);
  } catch (error) {
    const response: StudioColorRangeWorkerFailureMessage = {
      type: "studio-color-range/failure",
      version: STUDIO_COLOR_RANGE_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
