import { smudgeStroke } from "./studio-smudge";
import {
  STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION,
  studioSmudgeSuccessTransfers,
  type StudioSmudgeWorkerFailureMessage,
  type StudioSmudgeWorkerResponseMessage,
  type StudioSmudgeWorkerRunMessage,
  type StudioSmudgeWorkerSuccessMessage,
} from "./studio-smudge-worker-protocol";

interface StudioSmudgeWorkerScope {
  onmessage: ((event: MessageEvent<StudioSmudgeWorkerRunMessage>) => void) | null;
  postMessage(message: StudioSmudgeWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioSmudgeWorkerScope;

workerScope.postMessage({
  type: "studio-smudge/ready",
  version: STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioSmudgeWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || "문지르기 Worker 실행에 실패했습니다." };
  }
  return { name: "Error", message: "문지르기 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    message.type !== "studio-smudge/run" ||
    message.version !== STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    const { data, w, h, points, radiusPx, strength } = message.request;
    const result = smudgeStroke(data, w, h, points, radiusPx, strength);
    const response: StudioSmudgeWorkerSuccessMessage = {
      type: "studio-smudge/success",
      version: STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION,
      data: result,
    };
    workerScope.postMessage(response, studioSmudgeSuccessTransfers(response));
  } catch (error) {
    const response: StudioSmudgeWorkerFailureMessage = {
      type: "studio-smudge/failure",
      version: STUDIO_SMUDGE_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
