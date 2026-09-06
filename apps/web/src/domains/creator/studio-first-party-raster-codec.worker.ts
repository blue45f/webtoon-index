import { executeStudioCodecProvider } from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
} from "./studio-first-party-raster-codec-provider";
import {
  createStudioFirstPartyRasterCodecWorkerFailureMessage,
  createStudioFirstPartyRasterCodecWorkerProtocolFailure,
  parseStudioFirstPartyRasterCodecWorkerRunMessage,
  STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION,
  studioFirstPartyRasterCodecWorkerResponseCorrelation,
  studioFirstPartyRasterCodecWorkerSuccessTransfers,
  type StudioFirstPartyRasterCodecWorkerResponseMessage,
  type StudioFirstPartyRasterCodecWorkerSuccessMessage,
} from "./studio-first-party-raster-codec-worker-protocol";

export interface StudioFirstPartyRasterCodecWorkerDispatch {
  readonly response: StudioFirstPartyRasterCodecWorkerResponseMessage;
  readonly transfer: readonly Transferable[];
}

export interface StudioFirstPartyRasterCodecDedicatedWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(
    message: StudioFirstPartyRasterCodecWorkerResponseMessage,
    transfer: Transferable[],
  ): void;
  close(): void;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
    && bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return Uint8Array.from(bytes).buffer;
}

/**
 * Executes one message behind the real provider contract. The function is exported so the Worker
 * boundary can be tested without introducing a main-thread provider fallback in production.
 */
export async function executeStudioFirstPartyRasterCodecWorkerMessage(
  value: unknown,
): Promise<StudioFirstPartyRasterCodecWorkerDispatch | null> {
  const requestId =
    studioFirstPartyRasterCodecWorkerResponseCorrelation(value);
  let message;
  try {
    message = parseStudioFirstPartyRasterCodecWorkerRunMessage(value);
  } catch (error) {
    if (requestId === null) return null;
    return Object.freeze({
      response: createStudioFirstPartyRasterCodecWorkerProtocolFailure(
        requestId,
        error,
      ),
      transfer: Object.freeze([]),
    });
  }

  try {
    const result = await executeStudioCodecProvider(
      message.request,
      new Uint8Array(message.inputBytes),
      STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
    );
    if (!result.ok) {
      return Object.freeze({
        response: createStudioFirstPartyRasterCodecWorkerFailureMessage(
          message.requestId,
          "provider-failure",
          result.code,
        ),
        transfer: Object.freeze([]),
      });
    }

    const response: StudioFirstPartyRasterCodecWorkerSuccessMessage = {
      type: "studio-first-party-raster-codec/success",
      version: STUDIO_FIRST_PARTY_RASTER_CODEC_WORKER_PROTOCOL_VERSION,
      requestId: message.requestId,
      bytes: ownedArrayBuffer(result.bytes),
      receipt: result.receipt,
    };
    return Object.freeze({
      response,
      transfer: Object.freeze(
        studioFirstPartyRasterCodecWorkerSuccessTransfers(response),
      ),
    });
  } catch {
    return Object.freeze({
      response: createStudioFirstPartyRasterCodecWorkerFailureMessage(
        message.requestId,
        "execution-failed",
      ),
      transfer: Object.freeze([]),
    });
  }
}

function isDedicatedWorkerScope(): boolean {
  try {
    return (
      Object.prototype.toString.call(globalThis)
      === "[object DedicatedWorkerGlobalScope]"
    );
  } catch {
    return false;
  }
}

function postResponseOrClose(
  scope: StudioFirstPartyRasterCodecDedicatedWorkerScope,
  response: StudioFirstPartyRasterCodecWorkerResponseMessage,
  transfer: readonly Transferable[],
): boolean {
  try {
    scope.postMessage(response, [...transfer]);
    return true;
  } catch {
    try {
      scope.close();
    } catch {
      // The response boundary is already unusable. Never surface host-specific close errors.
    }
    return false;
  }
}

export function installStudioFirstPartyRasterCodecWorkerRuntime(
  scope: StudioFirstPartyRasterCodecDedicatedWorkerScope,
): void {
  let acceptedJob = false;
  scope.onmessage = (event) => {
    const requestId =
      studioFirstPartyRasterCodecWorkerResponseCorrelation(event.data);
    if (acceptedJob) {
      if (requestId !== null) {
        postResponseOrClose(
          scope,
          createStudioFirstPartyRasterCodecWorkerFailureMessage(
            requestId,
            "protocol-error",
          ),
          [],
        );
      }
      return;
    }
    acceptedJob = true;
    void executeStudioFirstPartyRasterCodecWorkerMessage(event.data).then(
      (dispatch) => {
        if (dispatch) {
          postResponseOrClose(
            scope,
            dispatch.response,
            dispatch.transfer,
          );
        }
      },
      () => {
        if (requestId !== null) {
          postResponseOrClose(
            scope,
            createStudioFirstPartyRasterCodecWorkerFailureMessage(
              requestId,
              "execution-failed",
            ),
            [],
          );
        }
      },
    );
  };
}

if (isDedicatedWorkerScope()) {
  installStudioFirstPartyRasterCodecWorkerRuntime(
    globalThis as unknown as
      StudioFirstPartyRasterCodecDedicatedWorkerScope,
  );
}
