import { createStudioPersistentCrc32Executor } from "./render/studio-wasm-crc32-kernel";
import {
  STUDIO_CRC32_WORKER_PROTOCOL_VERSION,
  studioCrc32SuccessTransfers,
  type StudioCrc32WorkerFailureMessage,
  type StudioCrc32WorkerResponseMessage,
  type StudioCrc32WorkerRunMessage,
  type StudioCrc32WorkerSuccessMessage,
} from "./studio-crc32-worker-protocol";

interface StudioCrc32WorkerScope {
  onmessage: ((event: MessageEvent<StudioCrc32WorkerRunMessage>) => void) | null;
  postMessage(message: StudioCrc32WorkerResponseMessage, transfer: Transferable[]): void;
}

const workerScope = globalThis as unknown as StudioCrc32WorkerScope;
const crc32Executor = createStudioPersistentCrc32Executor();

workerScope.postMessage({
  type: "studio-crc32/ready",
  version: STUDIO_CRC32_WORKER_PROTOCOL_VERSION,
}, []);

function serializeWorkerError(error: unknown): StudioCrc32WorkerFailureMessage["error"] {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || "CRC32 Worker 실행에 실패했습니다.",
    };
  }
  return { name: "Error", message: "CRC32 Worker 실행에 실패했습니다." };
}

workerScope.onmessage = (event) => {
  const message = event.data;
  if (
    message.type !== "studio-crc32/run"
    || message.version !== STUDIO_CRC32_WORKER_PROTOCOL_VERSION
  ) {
    return;
  }

  try {
    const response: StudioCrc32WorkerSuccessMessage = {
      type: "studio-crc32/success",
      version: STUDIO_CRC32_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      crc32: crc32Executor.calculate(message.data),
      data: message.data,
    };
    workerScope.postMessage(response, studioCrc32SuccessTransfers(response));
  } catch (error) {
    const response: StudioCrc32WorkerFailureMessage = {
      type: "studio-crc32/failure",
      version: STUDIO_CRC32_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      error: serializeWorkerError(error),
    };
    workerScope.postMessage(response, []);
  }
};
