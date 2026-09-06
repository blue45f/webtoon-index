import { applyHealCloneDabsFromSeparateRegions } from "./studio-heal-clone";
import {
  STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION,
  assertStudioHealCloneWorkerRequest,
  studioHealCloneSuccessTransfers,
  type StudioHealCloneWorkerFailureMessage,
  type StudioHealCloneWorkerResponseMessage,
  type StudioHealCloneWorkerRunMessage,
  type StudioHealCloneWorkerSuccessMessage,
} from "./studio-heal-clone-worker-protocol";

interface StudioHealCloneWorkerScope {
  onmessage: ((event: MessageEvent<StudioHealCloneWorkerRunMessage>) => void) | null;
  postMessage(message: StudioHealCloneWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioHealCloneWorkerScope;

workerScope.postMessage({
  type: "studio-heal-clone/ready",
  version: STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioHealCloneWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || "복구 브러시 Worker 실행에 실패했습니다." };
  }
  return { name: "Error", message: "복구 브러시 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    !message
    || typeof message !== "object"
    || message.type !== "studio-heal-clone/run"
    || message.version !== STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    assertStudioHealCloneWorkerRequest(message.request);
    const { src, dst, dabs, radiusPx, hardness, opacity, mode } = message.request;
    applyHealCloneDabsFromSeparateRegions(src, dst, dabs, radiusPx, hardness, opacity, mode);
    const response: StudioHealCloneWorkerSuccessMessage = {
      type: "studio-heal-clone/success",
      version: STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION,
      dst,
    };
    workerScope.postMessage(response, studioHealCloneSuccessTransfers(response));
  } catch (error) {
    const response: StudioHealCloneWorkerFailureMessage = {
      type: "studio-heal-clone/failure",
      version: STUDIO_HEAL_CLONE_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
