import {
  createStudioProceduralMediaSurfaceProvider,
  StudioProceduralMediaSurfaceError,
  type StudioProceduralMediaSurfaceProvider,
  type StudioProceduralMediaSurfaceRenderReceipt,
  type StudioProceduralMediaSurfaceRenderRequest,
  verifyStudioProceduralMediaSurfaceRenderReceiptIntegrityCooperatively,
} from "./studio-procedural-media-surface-provider";
import {
  createStudioProceduralMediaSurfaceWorkerVerifiedAttestation,
  snapshotStudioProceduralMediaSurfaceWorkerInboundMessage,
  snapshotStudioProceduralMediaSurfaceWorkerResultCooperatively,
  STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
  studioProceduralMediaSurfaceResultTransfers,
  studioProceduralMediaSurfaceWireRequestToProviderRequest,
  studioProceduralMediaSurfaceWorkerFailure,
  type StudioProceduralMediaSurfaceWorkerControlResultMessage,
  type StudioProceduralMediaSurfaceWorkerOutboundMessage,
  type StudioProceduralMediaSurfaceWorkerResult,
  type StudioProceduralMediaSurfaceWorkerResultMessage,
} from "./studio-procedural-media-surface-worker-protocol";

interface StudioProceduralMediaSurfaceWorkerMessageEvent {
  readonly data: unknown;
}

export interface StudioProceduralMediaSurfaceWorkerHostScope {
  postMessage(
    message: StudioProceduralMediaSurfaceWorkerOutboundMessage,
    transfer: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (
      event: StudioProceduralMediaSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (
      event: StudioProceduralMediaSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
}

export type StudioProceduralMediaSurfaceWorkerExecutor = (
  request: StudioProceduralMediaSurfaceRenderRequest,
) => StudioProceduralMediaSurfaceRenderReceipt
  | Promise<StudioProceduralMediaSurfaceRenderReceipt>;

export interface StudioProceduralMediaSurfaceWorkerHostOptions {
  readonly initialEngineEpoch?: number;
  readonly execute?: StudioProceduralMediaSurfaceWorkerExecutor;
}

export interface StudioProceduralMediaSurfaceWorkerHost {
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

function positiveEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) < Number.MAX_SAFE_INTEGER;
}

function createProvider(
  engineEpoch: number,
): StudioProceduralMediaSurfaceProvider {
  const creation = createStudioProceduralMediaSurfaceProvider({
    initialEngineEpoch: engineEpoch,
  });
  if (creation.status !== "ready") {
    throw new TypeError("Procedural media surface host options are invalid");
  }
  return creation.provider;
}

function rejection(
  reason: StudioProceduralMediaSurfaceError["code"],
): StudioProceduralMediaSurfaceWorkerResult {
  return Object.freeze({ status: "rejected", reason });
}

export function installStudioProceduralMediaSurfaceWorkerHost(
  scope: StudioProceduralMediaSurfaceWorkerHostScope,
  options: StudioProceduralMediaSurfaceWorkerHostOptions = {},
): StudioProceduralMediaSurfaceWorkerHost {
  const initialEngineEpoch = options.initialEngineEpoch ?? 1;
  if (
    !positiveEpoch(initialEngineEpoch)
    || (
      options.execute !== undefined
      && typeof options.execute !== "function"
    )
  ) throw new TypeError("Procedural media surface host options are invalid");

  let engineEpoch = initialEngineEpoch;
  let provider = createProvider(engineEpoch);
  let active: ActiveOperation | null = null;
  let disposed = false;
  const execute = options.execute;

  const postResult = async (
    requestId: number,
    requestSequence: number,
    resultEpoch: number,
    result: StudioProceduralMediaSurfaceWorkerResult,
    expectedRequest?: Omit<
      StudioProceduralMediaSurfaceRenderRequest,
      "signal"
    >,
    shouldContinue: () => boolean = () => !disposed,
  ): Promise<void> => {
    if (disposed) return;
    let snapshot =
      await snapshotStudioProceduralMediaSurfaceWorkerResultCooperatively(
        result,
        shouldContinue,
      );
    if (!shouldContinue()) return;
    if (
      snapshot?.status === "completed"
      && (
        expectedRequest === undefined
        || !await verifyStudioProceduralMediaSurfaceRenderReceiptIntegrityCooperatively(
          snapshot.receipt,
          expectedRequest,
          () => {
            if (!shouldContinue()) {
              throw new StudioProceduralMediaSurfaceError(
                "aborted",
                "Procedural media surface host verification was cancelled",
              );
            }
          },
        )
      )
    ) {
      snapshot = studioProceduralMediaSurfaceWorkerFailure(
        "invalid-result",
        "Procedural media surface host refused unverifiable executor output",
      );
    }
    const finalResult = snapshot ?? studioProceduralMediaSurfaceWorkerFailure(
      "invalid-result",
      "Procedural media surface host refused malformed executor output",
    );
    const message: StudioProceduralMediaSurfaceWorkerResultMessage = {
      type: "studio-procedural-media-surface/result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId,
      requestSequence,
      engineEpoch: resultEpoch,
      result: finalResult,
      verification: finalResult.status === "completed"
        ? createStudioProceduralMediaSurfaceWorkerVerifiedAttestation(
            requestId,
            finalResult.receipt,
          )
        : null,
    };
    if (!shouldContinue()) return;
    scope.postMessage(
      message,
      studioProceduralMediaSurfaceResultTransfers(message),
    );
  };

  const postControl = (
    requestId: number,
    control: "release" | "advance-epoch",
    released: boolean,
  ): void => {
    if (disposed) return;
    const message: StudioProceduralMediaSurfaceWorkerControlResultMessage = {
      type: "studio-procedural-media-surface/control-result",
      version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
      receipt: {
        kind: "studio-procedural-media-surface-worker-control-receipt",
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

  const recreateProvider = (nextEpoch: number): void => {
    provider.dispose();
    engineEpoch = nextEpoch;
    provider = createProvider(nextEpoch);
  };

  const onMessage = (
    event: StudioProceduralMediaSurfaceWorkerMessageEvent,
  ): void => {
    if (disposed) return;
    const message =
      snapshotStudioProceduralMediaSurfaceWorkerInboundMessage(event.data);
    if (message === null) return;
    if (message.type === "studio-procedural-media-surface/cancel") {
      if (active?.requestId === message.requestId) {
        active.controller.abort();
      }
      return;
    }
    if (message.type === "studio-procedural-media-surface/release") {
      if (active !== null || message.engineEpoch !== engineEpoch) {
        postControl(message.requestId, "release", false);
        return;
      }
      recreateProvider(engineEpoch);
      postControl(message.requestId, "release", true);
      return;
    }
    if (
      message.type === "studio-procedural-media-surface/advance-epoch"
    ) {
      active?.controller.abort();
      if (message.engineEpoch <= engineEpoch) {
        postControl(message.requestId, "advance-epoch", false);
        return;
      }
      active = null;
      recreateProvider(message.engineEpoch);
      postControl(message.requestId, "advance-epoch", true);
      return;
    }
    if (active !== null) {
      void postResult(
        message.requestId,
        message.request.requestSequence,
        message.request.engineEpoch,
        studioProceduralMediaSurfaceWorkerFailure(
          "backpressure",
          "Procedural media surface host already has an active operation",
        ),
      );
      return;
    }
    if (message.request.engineEpoch !== engineEpoch) {
      void postResult(
        message.requestId,
        message.request.requestSequence,
        message.request.engineEpoch,
        rejection("engine-epoch"),
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
    const request = studioProceduralMediaSurfaceWireRequestToProviderRequest(
      message.request,
      operation.controller.signal,
    );
    void Promise.resolve()
      .then(() => execute ? execute(request) : provider.render(request))
      .then(
        async (receipt) => {
          if (disposed || active !== operation) return;
          if (
            operation.controller.signal.aborted
            || operation.engineEpoch !== engineEpoch
          ) {
            await postResult(
              operation.requestId,
              operation.requestSequence,
              operation.engineEpoch,
              studioProceduralMediaSurfaceWorkerFailure(
                "aborted",
                "Procedural media surface host operation was cancelled",
              ),
            );
            return;
          }
          await postResult(
            operation.requestId,
            operation.requestSequence,
            operation.engineEpoch,
            Object.freeze({ status: "completed", receipt }),
            request,
            () =>
              !disposed
              && active === operation
              && !operation.controller.signal.aborted
              && operation.engineEpoch === engineEpoch,
          );
        },
        (error: unknown) => {
          if (disposed || active !== operation) return;
          if (error instanceof StudioProceduralMediaSurfaceError) {
            void postResult(
              operation.requestId,
              operation.requestSequence,
              operation.engineEpoch,
              error.code === "aborted"
                ? studioProceduralMediaSurfaceWorkerFailure(
                    "aborted",
                    "Procedural media surface host operation was cancelled",
                  )
                : rejection(error.code),
            );
            return;
          }
          void postResult(
            operation.requestId,
            operation.requestSequence,
            operation.engineEpoch,
            studioProceduralMediaSurfaceWorkerFailure(
              "execution-failed",
              "Procedural media surface host execution failed",
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
    type: "studio-procedural-media-surface/ready",
    version: STUDIO_PROCEDURAL_MEDIA_SURFACE_WORKER_PROTOCOL_VERSION,
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
