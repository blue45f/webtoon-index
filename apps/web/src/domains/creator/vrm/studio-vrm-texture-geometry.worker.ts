/// <reference lib="webworker" />

import {
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
  StudioVrmTextureGeometryWorkerComputationError,
  computeStudioVrmTextureGeometryWorkerTopology,
  isStudioVrmTextureGeometryWorkerRequest,
  studioVrmTextureGeometryWorkerResponseTransfers,
  type StudioVrmTextureGeometryWorkerFailureCode,
  type StudioVrmTextureGeometryWorkerRequest,
  type StudioVrmTextureGeometryWorkerResponse,
} from "./studio-vrm-texture-geometry-worker-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
let consumed = false;

function failureCode(cause: unknown): StudioVrmTextureGeometryWorkerFailureCode {
  return cause instanceof StudioVrmTextureGeometryWorkerComputationError
    ? cause.code
    : "invalid-input";
}

function postFailure(
  request: StudioVrmTextureGeometryWorkerRequest,
  cause: unknown,
): void {
  const response: StudioVrmTextureGeometryWorkerResponse = {
    version: STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
    kind: "error",
    requestId: request.requestId,
    generationId: request.generationId,
    code: failureCode(cause),
  };
  scope.postMessage(response);
}

function execute(request: StudioVrmTextureGeometryWorkerRequest): void {
  try {
    const topology = computeStudioVrmTextureGeometryWorkerTopology(request);
    const response: StudioVrmTextureGeometryWorkerResponse = {
      version: STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
      kind: "result",
      requestId: request.requestId,
      generationId: request.generationId,
      topology,
    };
    scope.postMessage(response, studioVrmTextureGeometryWorkerResponseTransfers(response));
  } catch (cause) {
    postFailure(request, cause);
  }
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (consumed || !isStudioVrmTextureGeometryWorkerRequest(event.data)) return;
  // One realm owns exactly one request. The client also terminates after settlement; retaining this
  // latch makes accidental/malicious second messages unable to reuse stale topology state.
  consumed = true;
  execute(event.data);
});
