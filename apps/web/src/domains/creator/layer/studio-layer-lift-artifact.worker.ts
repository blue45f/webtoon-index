/// <reference lib="webworker" />

import {
  StudioLayerLiftArtifactError,
  admitStudioLayerLiftArtifactPair,
} from "./studio-layer-lift-artifact";
import {
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND,
  getStudioLayerLiftArtifactWorkerResultTransferList,
  isStudioLayerLiftArtifactWorkerRequest,
  type StudioLayerLiftArtifactWorkerError,
  type StudioLayerLiftArtifactWorkerErrorCode,
  type StudioLayerLiftArtifactWorkerResult,
} from "./studio-layer-lift-artifact-worker-protocol";

const scope = self as DedicatedWorkerGlobalScope;
let consumed = false;

function safeSequence(
  value: unknown,
  key: "generation" | "sequence",
): number {
  if (typeof value !== "object" || value === null) {
    return 1;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  const candidate = descriptor?.value;
  return (
    Number.isSafeInteger(candidate) &&
    Number(candidate) > 0 &&
    Number(candidate) <= 0x7fff_ffff
  )
    ? Number(candidate)
    : 1;
}

function safeMessage(message: string): string {
  const normalized = Array.from(message.normalize("NFC"), (character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f ? " " : character;
  }).join("");
  return normalized.slice(0, 500) || "Layer-lift artifact validation failed.";
}

function postError(
  generation: number,
  sequence: number,
  code: StudioLayerLiftArtifactWorkerErrorCode,
  message: string,
): void {
  const response: StudioLayerLiftArtifactWorkerError = {
    version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_ERROR_KIND,
    generation,
    sequence,
    code,
    message: safeMessage(message),
  };
  scope.postMessage(response);
}

scope.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (consumed) {
    return;
  }
  consumed = true;

  const generation = safeSequence(event.data, "generation");
  const sequence = safeSequence(event.data, "sequence");
  if (!isStudioLayerLiftArtifactWorkerRequest(event.data)) {
    postError(
      generation,
      sequence,
      "protocol",
      "The layer-lift worker request failed protocol validation.",
    );
    return;
  }

  const request = event.data;
  void admitStudioLayerLiftArtifactPair({
    requestId: request.requestId,
    sourceId: request.sourceId,
    sourceWidth: request.sourceWidth,
    sourceHeight: request.sourceHeight,
    background: {
      outputId: request.backgroundOutputId,
      bytes: request.backgroundBytes,
    },
    foreground: {
      outputId: request.foregroundOutputId,
      bytes: request.foregroundBytes,
    },
  }).then((trustedPair) => {
    const response: StudioLayerLiftArtifactWorkerResult = {
      version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
      kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_RESULT_KIND,
      generation: request.generation,
      sequence: request.sequence,
      receipt: trustedPair.receipt,
      backgroundByteLength: trustedPair.background.byteLength,
      foregroundByteLength: trustedPair.foreground.byteLength,
      backgroundBytes: trustedPair.background.bytes,
      foregroundBytes: trustedPair.foreground.bytes,
    };
    scope.postMessage(
      response,
      getStudioLayerLiftArtifactWorkerResultTransferList(response),
    );
  }).catch((error: unknown) => {
    if (error instanceof StudioLayerLiftArtifactError) {
      postError(
        request.generation,
        request.sequence,
        error.code,
        error.message,
      );
      return;
    }
    postError(
      request.generation,
      request.sequence,
      "internal",
      "The layer-lift artifact worker failed unexpectedly.",
    );
  });
});

export {};
