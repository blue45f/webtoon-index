/// <reference lib="webworker" />

import { computeStudioVrmTextureFillMask } from "./studio-vrm-texture-fill";
import {
  STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
  isStudioVrmTextureFillWorkerRunMessage,
  studioVrmTextureFillSuccessTransfers,
  type StudioVrmTextureFillWorkerFailureMessage,
  type StudioVrmTextureFillWorkerResponseMessage,
  type StudioVrmTextureFillWorkerSerializedError,
  type StudioVrmTextureFillWorkerSuccessMessage,
} from "./studio-vrm-texture-fill-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let consumed = false;

scope.postMessage({
  type: "studio-vrm-texture-fill/ready",
  version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
} satisfies StudioVrmTextureFillWorkerResponseMessage);

function safeRequestId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, "requestId");
  if (
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length === 0 ||
    descriptor.value.length > 128
  ) return null;
  return descriptor.value;
}

function safeErrorString(value: unknown, fallback: string, maximumLength: number): string {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximumLength)
    : fallback;
}

function serializeWorkerError(error: unknown): StudioVrmTextureFillWorkerSerializedError {
  if (error instanceof Error) {
    const serialized: {
      name: string;
      message: string;
      code?: string;
    } = {
      name: safeErrorString(error.name, "Error", 128),
      message: safeErrorString(error.message, "3D 표면 채우기 계산에 실패했습니다.", 1_024),
    };
    const code = Object.getOwnPropertyDescriptor(error, "code");
    if (code && "value" in code && typeof code.value === "string" && code.value.length > 0) {
      serialized.code = code.value.slice(0, 128);
    }
    return serialized;
  }
  return {
    name: "Error",
    message: "3D 표면 채우기 계산에 실패했습니다.",
  };
}

function postFailure(requestId: string | null, error: unknown): void {
  const response: StudioVrmTextureFillWorkerFailureMessage = {
    type: "studio-vrm-texture-fill/failure",
    version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
    requestId,
    error: serializeWorkerError(error),
  };
  scope.postMessage(response);
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (consumed) return;
  consumed = true;

  const message = event.data;
  const requestId = safeRequestId(message);
  if (!isStudioVrmTextureFillWorkerRunMessage(message)) {
    postFailure(requestId, new TypeError("유효하지 않은 3D 표면 채우기 Worker 요청입니다."));
    return;
  }

  try {
    // This realm owns one synchronous fill job. Cancellation terminates the Worker, avoiding a
    // callback branch in every hot-loop iteration.
    const result = computeStudioVrmTextureFillMask(message.request);
    const response: StudioVrmTextureFillWorkerSuccessMessage = {
      type: "studio-vrm-texture-fill/success",
      version: STUDIO_VRM_TEXTURE_FILL_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      result,
    };
    scope.postMessage(response, studioVrmTextureFillSuccessTransfers(response));
  } catch (error) {
    postFailure(message.requestId, error);
  }
});
