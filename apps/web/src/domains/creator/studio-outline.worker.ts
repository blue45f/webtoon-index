import { applyOutline, normalizeOutline } from "./studio-outline";
import {
  STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION,
  assertStudioOutlineEpoch,
  assertStudioOutlineImageData,
  studioOutlineSuccessTransfers,
  type StudioOutlineWorkerFailureMessage,
  type StudioOutlineWorkerRequestMessage,
  type StudioOutlineWorkerResponseMessage,
  type StudioOutlineWorkerSuccessMessage,
} from "./studio-outline-worker-protocol";

interface StudioOutlineWorkerScope {
  onmessage: ((event: MessageEvent<StudioOutlineWorkerRequestMessage>) => void) | null;
  postMessage(
    message: StudioOutlineWorkerResponseMessage,
    transfer: Transferable[],
  ): void;
}

const workerScope = globalThis as unknown as StudioOutlineWorkerScope;

function serializeWorkerError(
  error: unknown,
): StudioOutlineWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "외곽선 Worker 실행에 실패했습니다.",
    };
  }
  return { name: "Error", message: "외곽선 Worker 실행에 실패했습니다." };
}

workerScope.postMessage({
  type: "studio-outline/ready",
  version: STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION,
}, []);

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    !message
    || typeof message !== "object"
    || message.type !== "studio-outline/run"
    || message.version !== STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }
  try {
    assertStudioOutlineEpoch(message.requestId, "외곽선 Worker requestId");
    assertStudioOutlineEpoch(message.epoch);
    assertStudioOutlineImageData(message.request.imageData);
    applyOutline(
      message.request.imageData,
      normalizeOutline(message.request.outline),
    );
    const response: StudioOutlineWorkerSuccessMessage = {
      type: "studio-outline/success",
      version: STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      epoch: message.epoch,
      imageData: message.request.imageData,
    };
    workerScope.postMessage(response, studioOutlineSuccessTransfers(response));
  } catch (error) {
    const response: StudioOutlineWorkerFailureMessage = {
      type: "studio-outline/failure",
      version: STUDIO_OUTLINE_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      epoch: message.epoch,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
