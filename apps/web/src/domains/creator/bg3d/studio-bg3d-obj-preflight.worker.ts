/// <reference lib="webworker" />

import {
  STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
  isStudioBg3dObjPreflightWorkerRequest,
  studioBg3dObjPreflightWorkerResponseTransfers,
  type StudioBg3dObjPreflightWorkerFailureCode,
  type StudioBg3dObjPreflightWorkerRequest,
  type StudioBg3dObjPreflightWorkerResponse,
} from "./studio-bg3d-obj-preflight-worker-protocol";
import {
  StudioBg3dObjPreflightWorkerRuntimeError,
  preflightStudioBg3dObjWorkerRequest,
} from "./studio-bg3d-obj-preflight-worker-runtime";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let activeIdentity: string | null = null;

function identityOf(request: StudioBg3dObjPreflightWorkerRequest): string {
  return `${request.generationId}:${request.requestId}`;
}

function failureCode(error: unknown): StudioBg3dObjPreflightWorkerFailureCode {
  return error instanceof StudioBg3dObjPreflightWorkerRuntimeError
    ? error.code
    : "parse-failed";
}

function postProgress(
  request: StudioBg3dObjPreflightWorkerRequest,
  stage: "decoding" | "scanning",
  progress: number,
): void {
  const response: StudioBg3dObjPreflightWorkerResponse = {
    version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
    kind: "progress",
    requestId: request.requestId,
    generationId: request.generationId,
    stage,
    progress,
  };
  scope.postMessage(response);
}

function execute(request: StudioBg3dObjPreflightWorkerRequest): void {
  try {
    postProgress(request, "decoding", 0.08);
    postProgress(request, "scanning", 0.32);
    const result = preflightStudioBg3dObjWorkerRequest(request);
    const response: StudioBg3dObjPreflightWorkerResponse = {
      version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      result,
    };
    scope.postMessage(response, studioBg3dObjPreflightWorkerResponseTransfers(response));
  } catch (error) {
    const response: StudioBg3dObjPreflightWorkerResponse = {
      version: STUDIO_BG3D_OBJ_PREFLIGHT_WORKER_PROTOCOL_VERSION,
      kind: "error",
      requestId: request.requestId,
      generationId: request.generationId,
      code: failureCode(error),
    };
    scope.postMessage(response);
  } finally {
    activeIdentity = null;
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  if (!isStudioBg3dObjPreflightWorkerRequest(request) || activeIdentity !== null) return;
  activeIdentity = identityOf(request);
  execute(request);
});
