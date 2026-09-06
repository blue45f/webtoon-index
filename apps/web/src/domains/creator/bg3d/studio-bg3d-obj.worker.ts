/// <reference lib="webworker" />

import {
  STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
  isStudioBg3dObjWorkerRequest,
  studioBg3dObjWorkerResponseTransfers,
  type StudioBg3dObjWorkerFailureCode,
  type StudioBg3dObjWorkerParseRequest,
  type StudioBg3dObjWorkerResponse,
} from "./studio-bg3d-obj-worker-protocol";
import {
  StudioBg3dObjWorkerRuntimeError,
  parseStudioBg3dObjWorkerRequest,
} from "./studio-bg3d-obj-worker-runtime";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let activeIdentity: string | null = null;

function identityOf(request: StudioBg3dObjWorkerParseRequest): string {
  return `${request.generationId}:${request.requestId}`;
}

function failureCode(error: unknown): StudioBg3dObjWorkerFailureCode {
  return error instanceof StudioBg3dObjWorkerRuntimeError ? error.code : "parse-failed";
}

function postProgress(
  request: StudioBg3dObjWorkerParseRequest,
  stage: "parsing" | "canonicalizing",
  progress: number,
): void {
  const response: StudioBg3dObjWorkerResponse = {
    version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
    kind: "progress",
    requestId: request.requestId,
    generationId: request.generationId,
    stage,
    progress,
  };
  scope.postMessage(response);
}

async function execute(request: StudioBg3dObjWorkerParseRequest): Promise<void> {
  try {
    postProgress(request, "parsing", 0.08);
    const result = await parseStudioBg3dObjWorkerRequest(request);
    postProgress(request, "canonicalizing", 0.82);
    const response: StudioBg3dObjWorkerResponse = {
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      result,
    };
    scope.postMessage(response, studioBg3dObjWorkerResponseTransfers(response));
  } catch (error) {
    const response: StudioBg3dObjWorkerResponse = {
      version: STUDIO_BG3D_OBJ_WORKER_PROTOCOL_VERSION,
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
  if (!isStudioBg3dObjWorkerRequest(request) || activeIdentity !== null) return;
  activeIdentity = identityOf(request);
  void execute(request);
});
