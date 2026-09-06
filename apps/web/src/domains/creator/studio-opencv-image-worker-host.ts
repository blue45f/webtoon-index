import {
  createStudioOpenCvImageProvider,
  studioOpenCvImageFailure,
  type StudioOpenCvImageProvider,
} from "./studio-opencv-image-provider";
import {
  STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
  isStudioOpenCvImageWorkerInboundMessage,
  studioOpenCvImageResultTransfers,
  type StudioOpenCvImageWorkerOutboundMessage,
  type StudioOpenCvImageWorkerResultMessage,
} from "./studio-opencv-image-worker-protocol";

interface StudioOpenCvWorkerMessageEvent {
  readonly data: unknown;
}

export interface StudioOpenCvImageWorkerHostScope {
  postMessage(
    message: StudioOpenCvImageWorkerOutboundMessage,
    transfer: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: StudioOpenCvWorkerMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: StudioOpenCvWorkerMessageEvent) => void,
  ): void;
}

export interface StudioOpenCvImageWorkerHost {
  readonly provider: StudioOpenCvImageProvider;
  dispose(): void;
}

/**
 * Installs the OpenCV executor into a Worker-like scope.
 *
 * Host tests inject a provider backed by a fake runtime; the emitted Worker uses
 * the default lazy package loader. Unknown messages are ignored and malformed
 * execute envelopes with an addressable request ID fail closed.
 */
export function installStudioOpenCvImageWorkerHost(
  scope: StudioOpenCvImageWorkerHostScope,
  provider: StudioOpenCvImageProvider = createStudioOpenCvImageProvider({
    requestEpoch: 0,
  }),
): StudioOpenCvImageWorkerHost {
  const abortControllers = new Map<number, AbortController>();
  let disposed = false;

  const postResult = (
    requestId: number,
    result: StudioOpenCvImageWorkerResultMessage["result"],
  ): void => {
    const response: StudioOpenCvImageWorkerResultMessage = {
      type: "studio-opencv-image/result",
      version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
      requestId,
      result,
    };
    scope.postMessage(response, studioOpenCvImageResultTransfers(response));
  };

  const onMessage = (event: StudioOpenCvWorkerMessageEvent): void => {
    if (disposed) return;
    const message = event.data;
    if (!isStudioOpenCvImageWorkerInboundMessage(message)) {
      if (
        typeof message === "object"
        && message !== null
        && "requestId" in message
        && typeof message.requestId === "number"
        && Number.isSafeInteger(message.requestId)
        && message.requestId > 0
      ) {
        postResult(
          message.requestId,
          studioOpenCvImageFailure(
            "invalid-input",
            "OpenCV Worker message failed protocol validation",
          ),
        );
      }
      return;
    }
    if (message.type === "studio-opencv-image/cancel") {
      abortControllers.get(message.requestId)?.abort();
      return;
    }
    if (message.type === "studio-opencv-image/advance-epoch") {
      if (provider.advanceRequestEpoch(message.requestEpoch)) {
        for (const controller of abortControllers.values()) controller.abort();
      }
      return;
    }
    if (abortControllers.has(message.requestId)) {
      postResult(
        message.requestId,
        studioOpenCvImageFailure(
          "invalid-input",
          "OpenCV Worker request ID is already active",
        ),
      );
      return;
    }

    const controller = new AbortController();
    abortControllers.set(message.requestId, controller);
    void provider.execute(message.request, { signal: controller.signal }).then(
      (result) => {
        if (!disposed) postResult(message.requestId, result);
      },
      () => {
        if (!disposed) {
          postResult(
            message.requestId,
            studioOpenCvImageFailure(
              "provider-failure",
              "OpenCV Worker host execution failed",
            ),
          );
        }
      },
    ).finally(() => {
      abortControllers.delete(message.requestId);
    });
  };

  scope.addEventListener("message", onMessage);
  scope.postMessage({
    type: "studio-opencv-image/ready",
    version: STUDIO_OPENCV_IMAGE_WORKER_PROTOCOL_VERSION,
    requestEpoch: provider.getDiagnostics().requestEpoch,
  }, []);

  return Object.freeze({
    provider,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scope.removeEventListener("message", onMessage);
      for (const controller of abortControllers.values()) controller.abort();
      abortControllers.clear();
      provider.dispose();
    },
  });
}
