import {
  applyStudioWeightedDeformation,
  type StudioWeightedDeformationRequest,
  type StudioWeightedDeformationResult,
} from "./studio-weighted-deformation-provider";
import {
  STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
  snapshotStudioWeightedDeformationWorkerInboundMessage,
  snapshotStudioWeightedDeformationWorkerResult,
  studioWeightedDeformationResultTransfers,
  studioWeightedDeformationWorkerFailure,
  type StudioWeightedDeformationWorkerOutboundMessage,
  type StudioWeightedDeformationWorkerResultMessage,
} from "./studio-weighted-deformation-worker-protocol";

interface StudioWeightedDeformationWorkerMessageEvent {
  readonly data: unknown;
}

export interface StudioWeightedDeformationWorkerHostScope {
  postMessage(
    message: StudioWeightedDeformationWorkerOutboundMessage,
    transfer: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (
      event: StudioWeightedDeformationWorkerMessageEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (
      event: StudioWeightedDeformationWorkerMessageEvent,
    ) => void,
  ): void;
}

export type StudioWeightedDeformationWorkerExecutor = (
  request: StudioWeightedDeformationRequest,
) => StudioWeightedDeformationResult | Promise<StudioWeightedDeformationResult>;

export interface StudioWeightedDeformationWorkerHostOptions {
  readonly currentEpoch?: number;
  readonly execute?: StudioWeightedDeformationWorkerExecutor;
}

export interface StudioWeightedDeformationWorkerHost {
  readonly currentEpoch: () => number;
  readonly activeRequestId: () => number | null;
  dispose(): void;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly requestEpoch: number;
  readonly controller: AbortController;
}

function validInitialEpoch(value: unknown): value is number {
  return (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
  );
}

function addressableRequestId(value: unknown): number | null {
  if (
    typeof value !== "object"
    || value === null
    || !("requestId" in value)
    || typeof value.requestId !== "number"
    || !Number.isSafeInteger(value.requestId)
    || value.requestId <= 0
  ) {
    return null;
  }
  return value.requestId;
}

/**
 * Installs a one-operation-at-a-time deformation host into a dedicated Worker.
 *
 * The default executor is the deterministic CPU oracle. Tests can inject an
 * asynchronous executor to exercise cancellation and backpressure without
 * introducing a main-thread production fallback.
 */
export function installStudioWeightedDeformationWorkerHost(
  scope: StudioWeightedDeformationWorkerHostScope,
  options: StudioWeightedDeformationWorkerHostOptions = {},
): StudioWeightedDeformationWorkerHost {
  const initialEpoch = options.currentEpoch ?? 0;
  if (
    !validInitialEpoch(initialEpoch)
    || (
      options.execute !== undefined
      && typeof options.execute !== "function"
    )
  ) {
    throw new TypeError(
      "Weighted deformation Worker host options are invalid",
    );
  }
  const execute = options.execute ?? applyStudioWeightedDeformation;
  let requestEpoch = initialEpoch;
  let active: ActiveOperation | null = null;
  let disposed = false;

  const postResult = (
    requestId: number,
    resultEpoch: number,
    result: StudioWeightedDeformationWorkerResultMessage["result"],
  ): void => {
    if (disposed) return;
    const message: StudioWeightedDeformationWorkerResultMessage = {
      type: "studio-weighted-deformation/result",
      version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
      requestId,
      requestEpoch: resultEpoch,
      result,
    };
    scope.postMessage(
      message,
      studioWeightedDeformationResultTransfers(message),
    );
  };

  const onMessage = (
    event: StudioWeightedDeformationWorkerMessageEvent,
  ): void => {
    if (disposed) return;
    const message = snapshotStudioWeightedDeformationWorkerInboundMessage(
      event.data,
    );
    if (message === null) {
      const invalidRequestId = addressableRequestId(event.data);
      if (invalidRequestId !== null) {
        postResult(
          invalidRequestId,
          Math.max(1, requestEpoch),
          studioWeightedDeformationWorkerFailure(
            "invalid-message",
            "Weighted deformation Worker message failed validation",
          ),
        );
      }
      return;
    }
    if (message.type === "studio-weighted-deformation/cancel") {
      if (active?.requestId === message.requestId) {
        active.controller.abort();
      }
      return;
    }
    if (message.type === "studio-weighted-deformation/advance-epoch") {
      if (message.currentEpoch > requestEpoch) {
        requestEpoch = message.currentEpoch;
        const invalidated = active;
        active = null;
        invalidated?.controller.abort();
      }
      return;
    }
    if (active !== null) {
      postResult(
        message.requestId,
        message.request.requestEpoch,
        studioWeightedDeformationWorkerFailure(
          "backpressure",
          "Weighted deformation Worker already has an active operation",
        ),
      );
      return;
    }
    if (
      message.request.requestEpoch !== requestEpoch
      || message.request.currentEpoch !== requestEpoch
    ) {
      postResult(
        message.requestId,
        message.request.requestEpoch,
        Object.freeze({ status: "rejected", reason: "stale-epoch" }),
      );
      return;
    }

    const operation: ActiveOperation = Object.freeze({
      requestId: message.requestId,
      requestEpoch: message.request.requestEpoch,
      controller: new AbortController(),
    });
    active = operation;
    const executionRequest: StudioWeightedDeformationRequest = {
      ...message.request,
      signal: operation.controller.signal,
    };
    void Promise.resolve()
      .then(() => execute(executionRequest))
      .then(
        (candidate) => {
          if (
            disposed
            || (
              active !== operation
              && operation.requestEpoch === requestEpoch
            )
          ) return;
          if (
            operation.controller.signal.aborted
            || operation.requestEpoch !== requestEpoch
          ) {
            postResult(
              operation.requestId,
              operation.requestEpoch,
              operation.requestEpoch === requestEpoch
                ? Object.freeze({ status: "cancelled" })
                : Object.freeze({
                    status: "rejected",
                    reason: "stale-epoch",
                  }),
            );
            return;
          }
          const result = snapshotStudioWeightedDeformationWorkerResult(
            candidate,
          );
          postResult(
            operation.requestId,
            operation.requestEpoch,
            result
              ?? studioWeightedDeformationWorkerFailure(
                "execution-failed",
                "Weighted deformation executor returned invalid output",
              ),
          );
        },
        () => {
          if (
            disposed
            || (
              active !== operation
              && operation.requestEpoch === requestEpoch
            )
          ) return;
          postResult(
            operation.requestId,
            operation.requestEpoch,
            studioWeightedDeformationWorkerFailure(
              "execution-failed",
              "Weighted deformation Worker execution failed",
            ),
          );
        },
      )
      .finally(() => {
        if (active === operation) active = null;
      });
  };

  scope.addEventListener("message", onMessage);
  scope.postMessage({
    type: "studio-weighted-deformation/ready",
    version: STUDIO_WEIGHTED_DEFORMATION_WORKER_PROTOCOL_VERSION,
    currentEpoch: requestEpoch,
  }, []);

  return Object.freeze({
    currentEpoch: () => requestEpoch,
    activeRequestId: () => active?.requestId ?? null,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scope.removeEventListener("message", onMessage);
      active?.controller.abort();
      active = null;
    },
  });
}
