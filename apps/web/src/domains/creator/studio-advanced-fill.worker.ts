import { applyAdvancedFill } from "./studio-advanced-fill";
import { postprocessStudioAdvancedFillWorkerResult } from "./studio-advanced-fill-worker-postprocess";
import {
  STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION,
  studioAdvancedFillSuccessTransfers,
  type StudioAdvancedFillWorkerFailureMessage,
  type StudioAdvancedFillWorkerResponseMessage,
  type StudioAdvancedFillWorkerRunMessage,
  type StudioAdvancedFillWorkerSuccessMessage,
} from "./studio-advanced-fill-worker-protocol";

interface StudioAdvancedFillWorkerScope {
  onmessage: ((event: MessageEvent<StudioAdvancedFillWorkerRunMessage>) => void) | null;
  postMessage(message: StudioAdvancedFillWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioAdvancedFillWorkerScope;

workerScope.postMessage({
  type: "studio-advanced-fill/ready",
  version: STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioAdvancedFillWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "고급 채우기 Worker 실행에 실패했습니다.",
    };
  }
  return { name: "Error", message: "고급 채우기 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    message.type !== "studio-advanced-fill/run" ||
    message.version !== STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    const result = postprocessStudioAdvancedFillWorkerResult(
      message.request,
      applyAdvancedFill(message.request),
    );
    const response: StudioAdvancedFillWorkerSuccessMessage = {
      type: "studio-advanced-fill/success",
      version: STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION,
      originalTarget: message.request.target,
      result,
    };
    workerScope.postMessage(response, studioAdvancedFillSuccessTransfers(response));
  } catch (error) {
    const response: StudioAdvancedFillWorkerFailureMessage = {
      type: "studio-advanced-fill/failure",
      version: STUDIO_ADVANCED_FILL_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
