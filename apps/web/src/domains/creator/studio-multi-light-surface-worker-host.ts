import {
  createStudioMultiLightSurfaceProvider,
  StudioMultiLightSurfaceError,
  type StudioMultiLightSurfaceReceipt,
  type StudioMultiLightSurfaceRequest,
} from "./studio-multi-light-surface-provider";
import {
  snapshotStudioMultiLightSurfaceWorkerInboundMessage,
  snapshotStudioMultiLightSurfaceWorkerResult,
  STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS,
  STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
  studioMultiLightSurfaceResultTransfers,
  studioMultiLightSurfaceWorkerFailure,
  studioMultiLightSurfaceWorkerRejected,
  type StudioMultiLightSurfaceWorkerOutboundMessage,
  type StudioMultiLightSurfaceWorkerResult,
  type StudioMultiLightSurfaceWorkerResultMessage,
} from "./studio-multi-light-surface-worker-protocol";

interface StudioMultiLightSurfaceWorkerMessageEvent {
  readonly data: unknown;
}

export interface StudioMultiLightSurfaceWorkerHostScope {
  postMessage(
    message: StudioMultiLightSurfaceWorkerOutboundMessage,
    transfer: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (
      event: StudioMultiLightSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (
      event: StudioMultiLightSurfaceWorkerMessageEvent,
    ) => void,
  ): void;
}

export type StudioMultiLightSurfaceWorkerExecutor = (
  request: StudioMultiLightSurfaceRequest,
) => StudioMultiLightSurfaceReceipt
  | Promise<StudioMultiLightSurfaceReceipt>;

export interface StudioMultiLightSurfaceWorkerHostOptions {
  readonly currentEpoch?: number;
  readonly execute?: StudioMultiLightSurfaceWorkerExecutor;
}

export interface StudioMultiLightSurfaceWorkerHost {
  readonly currentEpoch: () => number;
  readonly activeRequestId: () => number | null;
  dispose(): void;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly deviceEpoch: number;
  readonly requestSequence: number;
  readonly controller: AbortController;
}

function validEpoch(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value);
}

function addressableEnvelope(value: unknown): Readonly<{
  requestId: number;
  deviceEpoch: number;
  requestSequence: number;
}> | null {
  if (
    !isRecord(value)
    || !validEpoch(value.requestId)
    || !isRecord(value.request)
    || !validEpoch(value.request.deviceEpoch)
    || !validEpoch(value.request.requestSequence)
  ) return null;
  return Object.freeze({
    requestId: value.requestId,
    deviceEpoch: value.request.deviceEpoch,
    requestSequence: value.request.requestSequence,
  });
}

function createProvider(epoch: number) {
  const created = createStudioMultiLightSurfaceProvider({
    initialDeviceEpoch: epoch,
    maximumPixels:
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumPixels,
    maximumResidentBytes:
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumResidentBytes,
    maximumWorkUnits:
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumWorkUnits,
    maximumLights:
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumLights,
    tileEdge: STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.tileEdge,
    maximumTiles:
      STUDIO_MULTI_LIGHT_SURFACE_WORKER_LIMITS.maximumTiles,
  });
  if (created.status !== "ready") {
    throw new TypeError("Multi-light Worker provider budgets are invalid");
  }
  return created.provider;
}

export function installStudioMultiLightSurfaceWorkerHost(
  scope: StudioMultiLightSurfaceWorkerHostScope,
  options: StudioMultiLightSurfaceWorkerHostOptions = {},
): StudioMultiLightSurfaceWorkerHost {
  const initialEpoch = options.currentEpoch ?? 1;
  if (
    !validEpoch(initialEpoch)
    || (
      options.execute !== undefined
      && typeof options.execute !== "function"
    )
  ) {
    throw new TypeError("Multi-light surface Worker host options are invalid");
  }
  let currentEpoch = initialEpoch;
  let provider = createProvider(currentEpoch);
  let active: ActiveOperation | null = null;
  let disposed = false;

  const postResult = (
    requestId: number,
    deviceEpoch: number,
    requestSequence: number,
    candidate: StudioMultiLightSurfaceWorkerResult,
  ): void => {
    if (disposed) return;
    const result = snapshotStudioMultiLightSurfaceWorkerResult(candidate)
      ?? studioMultiLightSurfaceWorkerFailure(
        "execution-failed",
        "Multi-light surface executor returned invalid output",
      );
    const message: StudioMultiLightSurfaceWorkerResultMessage = {
      type: "studio-multi-light-surface/result",
      version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
      requestId,
      deviceEpoch,
      requestSequence,
      result,
    };
    scope.postMessage(
      message,
      studioMultiLightSurfaceResultTransfers(message),
    );
  };

  const onMessage = (
    event: StudioMultiLightSurfaceWorkerMessageEvent,
  ): void => {
    if (disposed) return;
    const message = snapshotStudioMultiLightSurfaceWorkerInboundMessage(
      event.data,
    );
    if (message === null) {
      const envelope = addressableEnvelope(event.data);
      if (envelope) {
        postResult(
          envelope.requestId,
          envelope.deviceEpoch,
          envelope.requestSequence,
          studioMultiLightSurfaceWorkerFailure(
            "invalid-message",
            "Multi-light surface Worker message failed validation",
          ),
        );
      }
      return;
    }
    if (message.type === "studio-multi-light-surface/cancel") {
      if (active?.requestId === message.requestId) {
        active.controller.abort();
      }
      return;
    }
    if (message.type === "studio-multi-light-surface/advance-epoch") {
      if (message.currentEpoch > currentEpoch) {
        currentEpoch = message.currentEpoch;
        const invalidated = active;
        active = null;
        invalidated?.controller.abort();
        provider.dispose();
        provider = createProvider(currentEpoch);
      }
      return;
    }
    if (active !== null) {
      postResult(
        message.requestId,
        message.request.deviceEpoch,
        message.request.requestSequence,
        studioMultiLightSurfaceWorkerFailure(
          "backpressure",
          "Multi-light surface Worker already has an active operation",
        ),
      );
      return;
    }
    if (message.request.deviceEpoch !== currentEpoch) {
      postResult(
        message.requestId,
        message.request.deviceEpoch,
        message.request.requestSequence,
        studioMultiLightSurfaceWorkerRejected(
          "device-epoch",
          "Multi-light surface request belongs to a stale epoch",
          "$.deviceEpoch",
        ),
      );
      return;
    }

    const operation: ActiveOperation = Object.freeze({
      requestId: message.requestId,
      deviceEpoch: message.request.deviceEpoch,
      requestSequence: message.request.requestSequence,
      controller: new AbortController(),
    });
    active = operation;
    const request: StudioMultiLightSurfaceRequest = {
      ...message.request,
      signal: operation.controller.signal,
    };
    const execute = options.execute
      ?? ((value: StudioMultiLightSurfaceRequest) => provider.execute(value));
    void Promise.resolve()
      .then(() => execute(request))
      .then(
        (receipt) => {
          if (disposed || active !== operation) return;
          if (
            operation.controller.signal.aborted
            || operation.deviceEpoch !== currentEpoch
          ) {
            postResult(
              operation.requestId,
              operation.deviceEpoch,
              operation.requestSequence,
              operation.deviceEpoch === currentEpoch
                ? Object.freeze({ status: "cancelled" })
                : studioMultiLightSurfaceWorkerRejected(
                    "device-epoch",
                    "Multi-light surface result belongs to a stale epoch",
                    "$.deviceEpoch",
                  ),
            );
            return;
          }
          postResult(
            operation.requestId,
            operation.deviceEpoch,
            operation.requestSequence,
            Object.freeze({ status: "completed", receipt }),
          );
        },
        (error: unknown) => {
          if (disposed || active !== operation) return;
          if (
            operation.controller.signal.aborted
            || (
              error instanceof StudioMultiLightSurfaceError
              && error.code === "aborted"
            )
          ) {
            postResult(
              operation.requestId,
              operation.deviceEpoch,
              operation.requestSequence,
              Object.freeze({ status: "cancelled" }),
            );
            return;
          }
          if (error instanceof StudioMultiLightSurfaceError) {
            postResult(
              operation.requestId,
              operation.deviceEpoch,
              operation.requestSequence,
              studioMultiLightSurfaceWorkerRejected(
                error.code,
                error.message,
                error.path,
              ),
            );
            return;
          }
          postResult(
            operation.requestId,
            operation.deviceEpoch,
            operation.requestSequence,
            studioMultiLightSurfaceWorkerFailure(
              "execution-failed",
              "Multi-light surface Worker execution failed",
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
    type: "studio-multi-light-surface/ready",
    version: STUDIO_MULTI_LIGHT_SURFACE_WORKER_PROTOCOL_VERSION,
    currentEpoch,
  }, []);

  return Object.freeze({
    currentEpoch: () => currentEpoch,
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
