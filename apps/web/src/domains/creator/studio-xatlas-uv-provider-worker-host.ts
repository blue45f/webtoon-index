import {
  createStudioXAtlasUvProvider,
  studioXAtlasUvFailure,
  type StudioXAtlasUvRuntime,
} from "./studio-xatlas-uv-provider";
import {
  isStudioXAtlasUvWorkerInboundMessage,
  STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
  studioXAtlasUvRequestHash,
  studioXAtlasUvResultHash,
  studioXAtlasUvResultTransfers,
  type StudioXAtlasUvWorkerOutboundMessage,
} from "./studio-xatlas-uv-provider-protocol";

export interface StudioXAtlasUvWorkerHostScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: StudioXAtlasUvWorkerOutboundMessage, transfer?: Transferable[]): void;
}

export interface StudioXAtlasUvWorkerHostOptions {
  readonly runtimeLoader?: () => StudioXAtlasUvRuntime | PromiseLike<StudioXAtlasUvRuntime>;
}

function candidateRequestId(value: unknown): string | null {
  if (
    typeof value !== "object"
    || value === null
    || !("requestId" in value)
    || typeof value.requestId !== "string"
    || value.requestId.length === 0
    || value.requestId.length > 128
  ) {
    return null;
  }
  return value.requestId;
}

export function installStudioXAtlasUvWorkerHost(
  scope: StudioXAtlasUvWorkerHostScope,
  options: StudioXAtlasUvWorkerHostOptions = {},
): void {
  let provider: ReturnType<typeof createStudioXAtlasUvProvider> | null = null;
  const abortControllers = new Map<string, AbortController>();

  scope.addEventListener("message", (event) => {
    const message = event.data;
    if (!isStudioXAtlasUvWorkerInboundMessage(message)) {
      const requestId = candidateRequestId(message);
      if (requestId !== null) {
        const result = studioXAtlasUvFailure(
          "invalid-input",
          "xatlas Worker received a malformed request",
        );
        scope.postMessage({
          type: "studio-xatlas-uv/result",
          version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
          requestId,
          result,
        });
      }
      return;
    }

    if (message.type === "studio-xatlas-uv/configure") {
      if (provider !== null) {
        scope.postMessage({
          type: "studio-xatlas-uv/startup-failure",
          version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
          detail: "xatlas Worker is already configured",
        });
        return;
      }
      try {
        provider = createStudioXAtlasUvProvider({
          requestEpoch: message.requestEpoch,
          documentEpoch: message.documentEpoch,
          inputOwnership: "transferred",
          ...(message.runtimeAssets === undefined
            ? {}
            : { runtimeAssets: message.runtimeAssets }),
          ...(message.limits === undefined ? {} : { limits: message.limits }),
          ...(options.runtimeLoader === undefined
            ? {}
            : { runtimeLoader: options.runtimeLoader }),
        });
        scope.postMessage({
          type: "studio-xatlas-uv/ready",
          version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
        });
      } catch {
        scope.postMessage({
          type: "studio-xatlas-uv/startup-failure",
          version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
          detail: "xatlas Worker configuration was rejected",
        });
      }
      return;
    }

    if (message.type === "studio-xatlas-uv/cancel") {
      abortControllers.get(message.requestId)?.abort();
      return;
    }

    if (message.type === "studio-xatlas-uv/advance-epochs") {
      provider?.advanceEpochs(message.requestEpoch, message.documentEpoch);
      return;
    }

    if (provider === null) {
      const result = studioXAtlasUvFailure(
        "provider-unavailable",
        "xatlas Worker is not configured",
      );
      scope.postMessage({
        type: "studio-xatlas-uv/result",
        version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        result,
      });
      return;
    }

    const controller = new AbortController();
    abortControllers.set(message.requestId, controller);
    const requestHash = studioXAtlasUvRequestHash(message.request);
    void provider.execute(message.request, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (abortControllers.get(message.requestId) !== controller) return;
        scope.postMessage({
          type: "studio-xatlas-uv/progress",
          version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
          requestId: message.requestId,
          sequence: progress.sequence,
          mode: progress.mode,
          progress: progress.progress,
        });
      },
    }).then((result) => {
      if (abortControllers.get(message.requestId) !== controller) return;
      abortControllers.delete(message.requestId);
      const response = {
        type: "studio-xatlas-uv/result",
        version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        result,
        ...(result.ok
          ? {
              binding: {
                requestEpoch: message.request.requestEpoch,
                documentEpoch: message.request.documentEpoch,
                requestHash,
                resultHash: studioXAtlasUvResultHash(result),
              },
            }
          : {}),
      } as const;
      scope.postMessage(response, studioXAtlasUvResultTransfers(result));
    }).catch(() => {
      if (abortControllers.get(message.requestId) !== controller) return;
      abortControllers.delete(message.requestId);
      const result = studioXAtlasUvFailure(
        "provider-failure",
        "xatlas Worker execution rejected unexpectedly",
      );
      scope.postMessage({
        type: "studio-xatlas-uv/result",
        version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        result,
      });
    });
  });
}
