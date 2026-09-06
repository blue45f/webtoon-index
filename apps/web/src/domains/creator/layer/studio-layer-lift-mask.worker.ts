/// <reference lib="webworker" />

import { prepareStudioLayerLiftMask } from "./studio-layer-lift-mask";
import {
  createStudioLayerLiftMaskWorkerFailureMessage,
  createStudioLayerLiftMaskWorkerResultMessage,
  isStudioLayerLiftMaskWorkerRunMessage,
  studioLayerLiftMaskWorkerResponseIdentity,
  studioLayerLiftMaskWorkerResponseTransfers,
  type StudioLayerLiftMaskWorkerResponseMessage,
  type StudioLayerLiftMaskWorkerRunMessage,
} from "./studio-layer-lift-mask-worker-protocol";

export interface StudioLayerLiftMaskWorkerDispatch {
  readonly response: StudioLayerLiftMaskWorkerResponseMessage;
  readonly transfer: readonly Transferable[];
}

export interface StudioLayerLiftMaskDedicatedWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(
    message: StudioLayerLiftMaskWorkerResponseMessage,
    transfer: Transferable[],
  ): void;
  close(): void;
}

function coreOptions(
  request: StudioLayerLiftMaskWorkerRunMessage,
) {
  const options = request.request.options;
  return {
    threshold: options.threshold,
    feather: options.feather,
    ...(options.morphology === null
      ? {}
      : { morphology: options.morphology }),
    ...(options.islands === null ? {} : { islands: options.islands }),
  };
}

/**
 * The core is synchronous and does not expose row/pass cancellation. Cancellation
 * authority therefore lives in the client, which terminates this entire realm.
 */
export function executeStudioLayerLiftMaskWorkerMessage(
  value: unknown,
): StudioLayerLiftMaskWorkerDispatch | null {
  const identity = studioLayerLiftMaskWorkerResponseIdentity(value);
  if (!isStudioLayerLiftMaskWorkerRunMessage(value)) {
    return identity === null
      ? null
      : Object.freeze({
          response: createStudioLayerLiftMaskWorkerFailureMessage(
            identity.requestId,
            identity.epoch,
            "protocol-error",
          ),
          transfer: Object.freeze([]),
        });
  }

  try {
    const confidencePlane = value.request.planes[0];
    const sourcePlane = value.request.planes[1];
    const result = prepareStudioLayerLiftMask({
      confidence: {
        width: confidencePlane.width,
        height: confidencePlane.height,
        confidence: new Float32Array(confidencePlane.buffer),
      },
      sourceAlpha: {
        width: sourcePlane.width,
        height: sourcePlane.height,
        alpha: new Uint8ClampedArray(sourcePlane.buffer),
      },
      options: coreOptions(value),
    });
    const response = createStudioLayerLiftMaskWorkerResultMessage(
      value,
      result,
    );
    return Object.freeze({
      response,
      transfer: Object.freeze(
        studioLayerLiftMaskWorkerResponseTransfers(response),
      ),
    });
  } catch {
    return Object.freeze({
      response: createStudioLayerLiftMaskWorkerFailureMessage(
        value.requestId,
        value.epoch,
        "execution-failed",
      ),
      transfer: Object.freeze([]),
    });
  }
}

function postOrClose(
  scope: StudioLayerLiftMaskDedicatedWorkerScope,
  dispatch: StudioLayerLiftMaskWorkerDispatch,
): void {
  try {
    scope.postMessage(dispatch.response, [...dispatch.transfer]);
  } catch {
    try {
      scope.close();
    } catch {
      // A failed transfer has made the realm unusable; closing is best effort.
    }
  }
}

export function installStudioLayerLiftMaskWorkerRuntime(
  scope: StudioLayerLiftMaskDedicatedWorkerScope,
): void {
  let running = false;
  scope.onmessage = (event) => {
    const identity = studioLayerLiftMaskWorkerResponseIdentity(event.data);
    if (running) {
      if (identity) {
        postOrClose(scope, {
          response: createStudioLayerLiftMaskWorkerFailureMessage(
            identity.requestId,
            identity.epoch,
            "protocol-error",
          ),
          transfer: [],
        });
      }
      return;
    }
    running = true;
    try {
      const dispatch = executeStudioLayerLiftMaskWorkerMessage(event.data);
      if (dispatch) postOrClose(scope, dispatch);
    } finally {
      running = false;
    }
  };
}

function isDedicatedWorkerScope(): boolean {
  try {
    return Object.prototype.toString.call(globalThis)
      === "[object DedicatedWorkerGlobalScope]";
  } catch {
    return false;
  }
}

if (isDedicatedWorkerScope()) {
  installStudioLayerLiftMaskWorkerRuntime(
    globalThis as unknown as StudioLayerLiftMaskDedicatedWorkerScope,
  );
}
