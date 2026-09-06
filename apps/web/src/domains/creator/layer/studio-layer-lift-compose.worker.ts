import {
  StudioLayerLiftComposeWorkerProtocolError,
  createStudioLayerLiftComposeWorkerError,
  createStudioLayerLiftComposeWorkerResult,
  decodeStudioLayerLiftComposeWorkerRequest,
  studioLayerLiftComposeWorkerResponseIdentity,
  studioLayerLiftComposeWorkerResultTransfers,
} from "./studio-layer-lift-compose-worker-protocol";
import {
  StudioLayerLiftCompositorError,
  composeStudioLayerLiftBeta,
} from "./studio-layer-lift-compositor";

import type {
  StudioLayerLiftComposeWorkerErrorCode,
  StudioLayerLiftComposeWorkerRequest,
  StudioLayerLiftComposeWorkerResponse,
} from "./studio-layer-lift-compose-worker-protocol";
import type {
  StudioLayerLiftCompositorOptions,
} from "./studio-layer-lift-compositor";

export interface StudioLayerLiftComposeWorkerDispatch {
  readonly response: StudioLayerLiftComposeWorkerResponse;
  readonly transfer: readonly ArrayBuffer[];
}

interface StudioLayerLiftComposeDedicatedWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  close(): void;
}

function fallbackIdentity(): Readonly<{
  readonly generation: number;
  readonly sequence: number;
}> {
  return Object.freeze({ generation: 1, sequence: 1 });
}

function errorCode(
  error: unknown,
): StudioLayerLiftComposeWorkerErrorCode {
  if (error instanceof StudioLayerLiftCompositorError) return error.code;
  if (error instanceof StudioLayerLiftComposeWorkerProtocolError) {
    return error.code === "budget-exceeded" ? "budget-exceeded" : "protocol";
  }
  return "internal";
}

/**
 * Exported for deterministic protocol/core tests. Production leaves PNG
 * encoding and native decode to the Worker realm; tests may inject a bounded
 * encoder/decoder without installing a fake global Worker.
 */
export async function executeStudioLayerLiftComposeWorkerMessage(
  value: unknown,
  options: StudioLayerLiftCompositorOptions = {},
): Promise<StudioLayerLiftComposeWorkerDispatch> {
  const identity =
    studioLayerLiftComposeWorkerResponseIdentity(value)
    ?? fallbackIdentity();
  try {
    const decoded = decodeStudioLayerLiftComposeWorkerRequest(value);
    const request = value as StudioLayerLiftComposeWorkerRequest;
    const result = await composeStudioLayerLiftBeta(decoded.input, options);
    const response = createStudioLayerLiftComposeWorkerResult(request, result);
    return Object.freeze({
      response,
      transfer: Object.freeze([
        ...studioLayerLiftComposeWorkerResultTransfers(response),
      ]),
    });
  } catch (error) {
    const response = createStudioLayerLiftComposeWorkerError(
      identity,
      errorCode(error),
      error instanceof Error
        ? error.message
        : "Layer Lift compositor failed closed.",
    );
    return Object.freeze({
      response,
      transfer: Object.freeze([]),
    });
  }
}

function postOrClose(
  scope: StudioLayerLiftComposeDedicatedWorkerScope,
  dispatch: StudioLayerLiftComposeWorkerDispatch,
): void {
  try {
    scope.postMessage(dispatch.response, [...dispatch.transfer]);
  } catch {
    try {
      scope.close();
    } catch {
      // Once a transfer fails the realm is no longer a safe reusable authority.
    }
  }
}

export function installStudioLayerLiftComposeWorkerRuntime(
  scope: StudioLayerLiftComposeDedicatedWorkerScope,
): void {
  let running = false;
  scope.onmessage = (event) => {
    if (running) {
      const identity =
        studioLayerLiftComposeWorkerResponseIdentity(event.data)
        ?? fallbackIdentity();
      postOrClose(scope, {
        response: createStudioLayerLiftComposeWorkerError(
          identity,
          "protocol",
          "Layer Lift compositor Worker capacity is one.",
        ),
        transfer: [],
      });
      return;
    }
    running = true;
    void executeStudioLayerLiftComposeWorkerMessage(event.data)
      .then((dispatch) => postOrClose(scope, dispatch))
      .finally(() => {
        running = false;
      });
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
  installStudioLayerLiftComposeWorkerRuntime(
    globalThis as unknown as StudioLayerLiftComposeDedicatedWorkerScope,
  );
}
