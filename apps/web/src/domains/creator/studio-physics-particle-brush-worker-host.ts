import {
  createStudioPhysicsParticleBrushProvider,
  StudioPhysicsParticleBrushError,
  type StudioPhysicsParticleBrushReceipt,
  type StudioPhysicsParticleBrushRequest,
} from "./studio-physics-particle-brush-provider";
import {
  snapshotStudioPhysicsParticleWorkerInboundMessage,
  snapshotStudioPhysicsParticleWorkerResult,
  STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
  studioPhysicsParticleWireRequestToProviderRequest,
  studioPhysicsParticleWorkerFailure,
  studioPhysicsParticleWorkerResultTransfers,
  type StudioPhysicsParticleWorkerOutboundMessage,
  type StudioPhysicsParticleWorkerResult,
  type StudioPhysicsParticleWorkerResultMessage,
} from "./studio-physics-particle-brush-worker-protocol";

interface StudioPhysicsParticleWorkerMessageEvent {
  readonly data: unknown;
}

export interface StudioPhysicsParticleWorkerHostScope {
  postMessage(
    message: StudioPhysicsParticleWorkerOutboundMessage,
    transfer: Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: StudioPhysicsParticleWorkerMessageEvent) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: StudioPhysicsParticleWorkerMessageEvent) => void,
  ): void;
}

export type StudioPhysicsParticleWorkerExecutor = (
  request: StudioPhysicsParticleBrushRequest,
) => StudioPhysicsParticleBrushReceipt
  | Promise<StudioPhysicsParticleBrushReceipt>;

export interface StudioPhysicsParticleWorkerHostOptions {
  readonly initialEpoch?: number;
  readonly execute?: StudioPhysicsParticleWorkerExecutor;
}

export interface StudioPhysicsParticleWorkerHost {
  readonly epoch: () => number;
  readonly activeRequestId: () => number | null;
  readonly workerSequence: () => number;
  dispose(): void;
}

interface ActiveOperation {
  readonly requestId: number;
  readonly requestEpoch: number;
  readonly workerSequence: number;
  readonly controller: AbortController;
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) < Number.MAX_SAFE_INTEGER;
}

function providerRejection(
  reason: StudioPhysicsParticleBrushError["code"],
): StudioPhysicsParticleWorkerResult {
  return Object.freeze({ status: "rejected", reason });
}

/**
 * The CPU oracle is deliberately imported only inside this dedicated-runtime
 * host. UI/client modules can therefore never fall back to main-thread
 * particle computation when Worker construction or execution fails.
 */
export function installStudioPhysicsParticleWorkerHost(
  scope: StudioPhysicsParticleWorkerHostScope,
  options: StudioPhysicsParticleWorkerHostOptions = {},
): StudioPhysicsParticleWorkerHost {
  const initialEpoch = options.initialEpoch ?? 0;
  if (
    !validEpoch(initialEpoch)
    || (
      options.execute !== undefined
      && typeof options.execute !== "function"
    )
  ) throw new TypeError("Physics particle Worker host options are invalid");

  const provider = createStudioPhysicsParticleBrushProvider({
    epoch: initialEpoch,
  });
  const execute = options.execute;
  let epoch = initialEpoch;
  let workerSequence = 0;
  let active: ActiveOperation | null = null;
  let disposed = false;

  const postResult = (
    requestId: number,
    requestEpoch: number,
    sequence: number,
    candidate: StudioPhysicsParticleWorkerResult,
  ): void => {
    if (disposed) return;
    const result = snapshotStudioPhysicsParticleWorkerResult(candidate)
      ?? studioPhysicsParticleWorkerFailure(
        "invalid-result",
        "Physics particle Worker host refused malformed executor output",
      );
    const output: StudioPhysicsParticleWorkerResultMessage = {
      type: "studio-physics-particle/result",
      version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
      requestId,
      requestEpoch,
      workerSequence: sequence,
      result,
    };
    scope.postMessage(
      output,
      studioPhysicsParticleWorkerResultTransfers(output),
    );
  };

  const onMessage = (
    event: StudioPhysicsParticleWorkerMessageEvent,
  ): void => {
    if (disposed) return;
    const message = snapshotStudioPhysicsParticleWorkerInboundMessage(
      event.data,
    );
    if (message === null) return;

    if (
      message.type === "studio-physics-particle/cancel"
      || message.type === "studio-physics-particle/release"
    ) {
      if (active?.requestId === message.requestId) {
        active.controller.abort();
      }
      return;
    }
    if (message.type === "studio-physics-particle/advance-epoch") {
      if (message.epoch < epoch) return;
      active?.controller.abort();
      provider.setEpoch(message.epoch);
      epoch = message.epoch;
      if (workerSequence === 0) {
        scope.postMessage({
          type: "studio-physics-particle/ready",
          version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
          epoch,
          workerSequence: 0,
        }, []);
      }
      return;
    }
    if (active !== null) {
      postResult(
        message.requestId,
        message.request.requestEpoch,
        message.workerSequence,
        studioPhysicsParticleWorkerFailure(
          "backpressure",
          "Physics particle Worker host already has an active operation",
        ),
      );
      return;
    }
    if (message.request.requestEpoch !== epoch) {
      postResult(
        message.requestId,
        message.request.requestEpoch,
        message.workerSequence,
        Object.freeze({ status: "rejected", reason: "stale-epoch" }),
      );
      return;
    }
    if (message.workerSequence !== workerSequence + 1) {
      postResult(
        message.requestId,
        message.request.requestEpoch,
        message.workerSequence,
        studioPhysicsParticleWorkerFailure(
          "protocol-error",
          "Physics particle Worker sequence is not monotonic",
        ),
      );
      return;
    }

    workerSequence = message.workerSequence;
    const operation: ActiveOperation = Object.freeze({
      requestId: message.requestId,
      requestEpoch: message.request.requestEpoch,
      workerSequence: message.workerSequence,
      controller: new AbortController(),
    });
    active = operation;
    const request = studioPhysicsParticleWireRequestToProviderRequest(
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
            || operation.requestEpoch !== epoch
          ) {
            postResult(
              operation.requestId,
              operation.requestEpoch,
              operation.workerSequence,
              Object.freeze({ status: "cancelled" }),
            );
            return;
          }
          postResult(
            operation.requestId,
            operation.requestEpoch,
            operation.workerSequence,
            Object.freeze({ status: "completed", receipt }),
          );
        },
        (error: unknown) => {
          if (disposed || active !== operation) return;
          if (error instanceof StudioPhysicsParticleBrushError) {
            postResult(
              operation.requestId,
              operation.requestEpoch,
              operation.workerSequence,
              error.code === "aborted"
                ? Object.freeze({ status: "cancelled" })
                : providerRejection(error.code),
            );
            return;
          }
          postResult(
            operation.requestId,
            operation.requestEpoch,
            operation.workerSequence,
            studioPhysicsParticleWorkerFailure(
              "execution-failed",
              "Physics particle Worker host execution failed",
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
    type: "studio-physics-particle/ready",
    version: STUDIO_PHYSICS_PARTICLE_WORKER_PROTOCOL_VERSION,
    epoch,
    workerSequence: 0,
  }, []);

  return Object.freeze({
    epoch: () => epoch,
    activeRequestId: () => active?.requestId ?? null,
    workerSequence: () => workerSequence,
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
