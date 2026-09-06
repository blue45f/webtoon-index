import { scanMagicWandRegionFromImageData } from "./studio-magic-wand";
import {
  STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION,
  type StudioMagicWandWorkerFailureMessage,
  type StudioMagicWandWorkerResponseMessage,
  type StudioMagicWandWorkerRunMessage,
  type StudioMagicWandWorkerSuccessMessage,
} from "./studio-magic-wand-worker-protocol";

interface StudioMagicWandWorkerScope {
  onmessage: ((event: MessageEvent<StudioMagicWandWorkerRunMessage>) => void) | null;
  postMessage(message: StudioMagicWandWorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioMagicWandWorkerScope;

workerScope.postMessage({
  type: "studio-magic-wand/ready",
  version: STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioMagicWandWorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || "마술봉 Worker 실행에 실패했습니다." };
  }
  return { name: "Error", message: "마술봉 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    message.type !== "studio-magic-wand/run" ||
    message.version !== STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    const { data, w, h, startX, startY, tolerance } = message.request;
    const region = scanMagicWandRegionFromImageData(data, w, h, startX, startY, tolerance);
    const response: StudioMagicWandWorkerSuccessMessage = {
      type: "studio-magic-wand/success",
      version: STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION,
      region,
    };
    workerScope.postMessage(response, []);
  } catch (error) {
    const response: StudioMagicWandWorkerFailureMessage = {
      type: "studio-magic-wand/failure",
      version: STUDIO_MAGIC_WAND_WORKER_PROTOCOL_VERSION,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
