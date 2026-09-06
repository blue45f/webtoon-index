/// <reference lib="webworker" />

import {
  createStudioPaperVectorRefinementProvider,
  type StudioPaperVectorRefinementProvider,
} from "./studio-paper-vector-refinement-provider";
import {
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
  STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH,
  decodeStudioPaperVectorRefinementWorkerRequest,
  encodeStudioPaperVectorRefinementWorkerArtifact,
  snapshotStudioPaperVectorRefinementWorkerInboundMessage,
  studioPaperVectorRefinementWorkerArtifactTransfers,
  type StudioPaperVectorRefinementWorkerFailureMessage,
  type StudioPaperVectorRefinementWorkerOutboundMessage,
} from "./studio-paper-vector-refinement-worker-protocol";

interface StudioPaperVectorRefinementWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: StudioPaperVectorRefinementWorkerOutboundMessage, transfer?: Transferable[]): void;
  close(): void;
}

const scope = globalThis as unknown as StudioPaperVectorRefinementWorkerScope;
let provider: StudioPaperVectorRefinementProvider | null = null;
let generation: number | null = null;
let engineEpoch: number | null = null;
let active = false;
let closed = false;

function safeDetail(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback).slice(0, 512);
}

function closeWorker(): void {
  if (closed) return;
  closed = true;
  try {
    provider?.dispose();
  } finally {
    provider = null;
    scope.close();
  }
}

function failure(
  reason: StudioPaperVectorRefinementWorkerFailureMessage["reason"],
  detail: string,
  requestId: number | null = null,
  fatal = false,
): void {
  const message: StudioPaperVectorRefinementWorkerFailureMessage = {
    type: "studio-paper-vector-refinement/failure",
    version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
    generation,
    requestId,
    reason,
    detail: detail.slice(0, 512),
  };
  try {
    scope.postMessage(message);
  } finally {
    if (fatal) closeWorker();
  }
}

scope.onmessageerror = () => {
  failure(
    "data-clone-failed",
    "The Paper refinement Worker could not clone the inbound message.",
    null,
    true,
  );
};

scope.onmessage = (event) => {
  if (closed) return;
  const message =
    snapshotStudioPaperVectorRefinementWorkerInboundMessage(event.data);
  if (message === null) {
    failure(
      "invalid-message",
      "The Paper refinement Worker rejected an invalid protocol message.",
      null,
      true,
    );
    return;
  }

  if (message.type === "studio-paper-vector-refinement/configure") {
    if (provider !== null || generation !== null || active) {
      failure(
        "invalid-configuration",
        "The Paper refinement Worker may be configured exactly once.",
        null,
        true,
      );
      return;
    }
    const creation = createStudioPaperVectorRefinementProvider({
      engineEpoch: message.engineEpoch,
      ...(message.limits === null ? {} : { limits: message.limits }),
    });
    if (creation.status !== "ready") {
      failure(
        "provider-creation-failed",
        "The Paper refinement provider rejected Worker configuration.",
        null,
        true,
      );
      return;
    }
    provider = creation.provider;
    generation = message.generation;
    engineEpoch = message.engineEpoch;
    scope.postMessage({
      type: "studio-paper-vector-refinement/configured",
      version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
      generation,
      engineEpoch,
    });
    return;
  }

  if (provider === null || generation === null || engineEpoch === null) {
    failure(
      "not-configured",
      "The Paper refinement Worker must be configured before execution.",
      message.requestId,
      true,
    );
    return;
  }
  if (
    message.generation !== generation
    || message.engineEpoch !== engineEpoch
  ) {
    failure(
      "invalid-message",
      "The Paper refinement request belongs to a stale Worker generation.",
      message.requestId,
      true,
    );
    return;
  }
  if (active) {
    failure(
      "backpressure",
      "The Paper refinement Worker already has an active operation.",
      message.requestId,
    );
    return;
  }
  const request = decodeStudioPaperVectorRefinementWorkerRequest(message);
  if (request === null) {
    failure(
      "invalid-message",
      "The Paper refinement Worker could not decode the request.",
      message.requestId,
      true,
    );
    return;
  }

  active = true;
  void (async () => {
    try {
      const result = await provider!.refine(request);
      if (closed) return;
      if (result.status === "rejected") {
        scope.postMessage({
          type: "studio-paper-vector-refinement/rejected",
          version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
          generation: message.generation,
          requestId: message.requestId,
          requestSequence: message.requestSequence,
          engineEpoch: message.engineEpoch,
          reason: result.reason,
          detail: result.detail.slice(0, 512),
        });
        return;
      }
      const artifact =
        encodeStudioPaperVectorRefinementWorkerArtifact(result.artifact);
      if (artifact === null) {
        failure(
          "execution-failed",
          "The Paper refinement provider returned an invalid transferable artifact.",
          message.requestId,
          true,
        );
        return;
      }
      const response = {
        type: "studio-paper-vector-refinement/result",
        version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
        generation: message.generation,
        requestId: message.requestId,
        requestSequence: message.requestSequence,
        engineEpoch: message.engineEpoch,
        artifact,
      } as const;
      scope.postMessage(
        response,
        studioPaperVectorRefinementWorkerArtifactTransfers(artifact),
      );
    } catch (error) {
      failure(
        "execution-failed",
        safeDetail(error, "The Paper refinement Worker operation failed."),
        message.requestId,
        true,
      );
    } finally {
      active = false;
    }
  })();
};

scope.postMessage({
  type: "studio-paper-vector-refinement/ready",
  version: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_PROTOCOL_VERSION,
  runtimeEpoch: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_RUNTIME_EPOCH,
  executionLocality: "dedicated-worker",
  mainThreadFallback: false,
  capabilities: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_CAPABILITIES,
  hardLimits: STUDIO_PAPER_VECTOR_REFINEMENT_WORKER_HARD_LIMITS,
});
