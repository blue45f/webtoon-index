import {
  createStudioFiberBristleBrushProvider,
  StudioFiberBristleBrushError,
  type StudioFiberBristleRenderReceipt,
  type StudioFiberBristleRenderRequest,
} from "./studio-fiber-bristle-brush-provider";
import {
  snapshotStudioFiberBristleWorkerInboundMessage,
  snapshotStudioFiberBristleWorkerResult,
  STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
  studioFiberBristleResultTransfers,
  studioFiberBristleWireRequestToProviderRequest,
  studioFiberBristleWorkerFailure,
  type StudioFiberBristleWorkerControlResultMessage,
  type StudioFiberBristleWorkerOutboundMessage,
  type StudioFiberBristleWorkerResult,
  type StudioFiberBristleWorkerResultMessage,
} from "./studio-fiber-bristle-brush-worker-protocol";

interface StudioFiberBristleWorkerMessageEvent {
  readonly data: unknown;
}

export interface StudioFiberBristleWorkerHostScope {
  postMessage(
    message: StudioFiberBristleWorkerOutboundMessage,
    transfer: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: StudioFiberBristleWorkerMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: StudioFiberBristleWorkerMessageEvent) => void,
  ): void;
}

export type StudioFiberBristleWorkerExecutor = (
  request: StudioFiberBristleRenderRequest,
) => StudioFiberBristleRenderReceipt
  | Promise<StudioFiberBristleRenderReceipt>;

export interface StudioFiberBristleWorkerHostOptions {
  readonly initialEngineEpoch?: number;
  readonly execute?: StudioFiberBristleWorkerExecutor;
}

export interface StudioFiberBristleWorkerHost {
  readonly engineEpoch: () => number;
  readonly activeRequestId: () => number | null;
  dispose(): void;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly requestSequence: number;
  readonly engineEpoch: number;
  readonly controller: AbortController;
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) < Number.MAX_SAFE_INTEGER;
}

function createProvider(epoch: number) {
  const creation = createStudioFiberBristleBrushProvider({
    initialEngineEpoch: epoch,
  });
  if (creation.status !== "ready") {
    throw new TypeError("Fiber bristle host provider options are invalid");
  }
  return creation.provider;
}

function providerRejection(
  reason: StudioFiberBristleBrushError["code"],
): StudioFiberBristleWorkerResult {
  return Object.freeze({ status: "rejected", reason });
}

/**
 * Installs the one-operation-at-a-time execution boundary in a dedicated
 * runtime. The default executor is reachable only from this host module.
 */
export function installStudioFiberBristleWorkerHost(
  scope: StudioFiberBristleWorkerHostScope,
  options: StudioFiberBristleWorkerHostOptions = {},
): StudioFiberBristleWorkerHost {
  const initialEngineEpoch = options.initialEngineEpoch ?? 1;
  if (
    !validEpoch(initialEngineEpoch)
    || (
      options.execute !== undefined
      && typeof options.execute !== "function"
    )
  ) throw new TypeError("Fiber bristle host options are invalid");

  let provider = createProvider(initialEngineEpoch);
  let engineEpoch = initialEngineEpoch;
  let active: ActiveOperation | null = null;
  let disposed = false;
  const execute = options.execute;

  const postResult = (
    requestId: number,
    requestSequence: number,
    resultEpoch: number,
    result: StudioFiberBristleWorkerResult,
  ): void => {
    if (disposed) return;
    const candidate: StudioFiberBristleWorkerResultMessage = {
      type: "studio-fiber-bristle/result",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      requestId,
      requestSequence,
      engineEpoch: resultEpoch,
      result,
    };
    const message = snapshotStudioFiberBristleWorkerResult(candidate.result);
    const output: StudioFiberBristleWorkerResultMessage = {
      ...candidate,
      result: message ?? studioFiberBristleWorkerFailure(
        "invalid-result",
        "Fiber bristle host refused malformed executor output",
      ),
    };
    scope.postMessage(output, studioFiberBristleResultTransfers(output));
  };

  const postControl = (
    requestId: number,
    control: "release" | "advance-epoch",
    released: boolean,
  ): void => {
    if (disposed) return;
    const message: StudioFiberBristleWorkerControlResultMessage = {
      type: "studio-fiber-bristle/control-result",
      version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
      receipt: {
        kind: "studio-fiber-bristle-worker-control-receipt",
        control,
        requestId,
        engineEpoch,
        released,
        execution: "dedicated-worker",
        mainThreadComputationFallback: false,
        workerTerminated: false,
        complete: true,
      },
    };
    scope.postMessage(message, []);
  };

  const onMessage = (
    event: StudioFiberBristleWorkerMessageEvent,
  ): void => {
    if (disposed) return;
    const message = snapshotStudioFiberBristleWorkerInboundMessage(
      event.data,
    );
    if (message === null) return;

    if (message.type === "studio-fiber-bristle/cancel") {
      if (active?.requestId === message.requestId) {
        active.controller.abort();
      }
      return;
    }
    if (message.type === "studio-fiber-bristle/release") {
      if (message.engineEpoch !== engineEpoch) {
        postControl(message.requestId, "release", false);
        return;
      }
      const invalidated = active;
      active = null;
      invalidated?.controller.abort();
      postControl(
        message.requestId,
        "release",
        provider.releaseStroke(message.strokeId),
      );
      return;
    }
    if (message.type === "studio-fiber-bristle/advance-epoch") {
      if (message.engineEpoch <= engineEpoch) {
        postControl(message.requestId, "advance-epoch", false);
        return;
      }
      const invalidated = active;
      active = null;
      invalidated?.controller.abort();
      provider.dispose();
      engineEpoch = message.engineEpoch;
      provider = createProvider(engineEpoch);
      postControl(message.requestId, "advance-epoch", true);
      return;
    }
    if (active !== null) {
      postResult(
        message.requestId,
        message.request.requestSequence,
        message.request.engineEpoch,
        studioFiberBristleWorkerFailure(
          "backpressure",
          "Fiber bristle host already has an active operation",
        ),
      );
      return;
    }
    if (message.request.engineEpoch !== engineEpoch) {
      postResult(
        message.requestId,
        message.request.requestSequence,
        message.request.engineEpoch,
        providerRejection("engine-epoch"),
      );
      return;
    }

    const operation: ActiveOperation = Object.freeze({
      requestId: message.requestId,
      requestSequence: message.request.requestSequence,
      engineEpoch: message.request.engineEpoch,
      controller: new AbortController(),
    });
    active = operation;
    const request = studioFiberBristleWireRequestToProviderRequest(
      message.request,
      operation.controller.signal,
    );
    void Promise.resolve()
      .then(() => execute ? execute(request) : provider.render(request))
      .then(
        (receipt) => {
          if (disposed || active !== operation) return;
          if (
            operation.controller.signal.aborted
            || operation.engineEpoch !== engineEpoch
          ) {
            postResult(
              operation.requestId,
              operation.requestSequence,
              operation.engineEpoch,
              studioFiberBristleWorkerFailure(
                "aborted",
                "Fiber bristle host operation was cancelled",
              ),
            );
            return;
          }
          postResult(
            operation.requestId,
            operation.requestSequence,
            operation.engineEpoch,
            Object.freeze({ status: "completed", receipt }),
          );
        },
        (error: unknown) => {
          if (disposed || active !== operation) return;
          if (error instanceof StudioFiberBristleBrushError) {
            postResult(
              operation.requestId,
              operation.requestSequence,
              operation.engineEpoch,
              error.code === "aborted"
                ? studioFiberBristleWorkerFailure(
                    "aborted",
                    "Fiber bristle host operation was cancelled",
                  )
                : providerRejection(error.code),
            );
            return;
          }
          postResult(
            operation.requestId,
            operation.requestSequence,
            operation.engineEpoch,
            studioFiberBristleWorkerFailure(
              "execution-failed",
              "Fiber bristle host execution failed",
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
    type: "studio-fiber-bristle/ready",
    version: STUDIO_FIBER_BRISTLE_WORKER_PROTOCOL_VERSION,
    engineEpoch,
  }, []);

  return Object.freeze({
    engineEpoch: () => engineEpoch,
    activeRequestId: () => active?.requestId ?? null,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scope.removeEventListener("message", onMessage);
      active?.controller.abort();
      active = null;
      provider.dispose();
    },
  });
}
