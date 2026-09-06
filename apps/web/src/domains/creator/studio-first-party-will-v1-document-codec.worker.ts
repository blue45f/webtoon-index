import { executeStudioCodecProvider } from "./studio-codec-provider-contract";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
} from "./studio-first-party-will-v1-document-codec-provider";
import {
  createStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage,
  createStudioFirstPartyWillV1DocumentCodecWorkerProtocolFailure,
  parseStudioFirstPartyWillV1DocumentCodecWorkerRunMessage,
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION,
  studioFirstPartyWillV1DocumentCodecWorkerResponseCorrelation,
  studioFirstPartyWillV1DocumentCodecWorkerSuccessTransfers,
  type StudioFirstPartyWillV1DocumentCodecWorkerResponseMessage,
  type StudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage,
} from "./studio-first-party-will-v1-document-codec-worker-protocol";

export interface StudioFirstPartyWillV1DocumentCodecWorkerDispatch {
  readonly response:
    StudioFirstPartyWillV1DocumentCodecWorkerResponseMessage;
  readonly transfer: readonly Transferable[];
}

export interface StudioFirstPartyWillV1DocumentCodecDedicatedWorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(
    message: StudioFirstPartyWillV1DocumentCodecWorkerResponseMessage,
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
 * Executes the exact built-in provider behind a transferable one-job Worker boundary.
 *
 * Exporting this dispatcher permits protocol/runtime tests without introducing a production
 * main-thread fallback.
 */
export async function executeStudioFirstPartyWillV1DocumentCodecWorkerMessage(
  value: unknown,
): Promise<
  StudioFirstPartyWillV1DocumentCodecWorkerDispatch | null
> {
  const requestId =
    studioFirstPartyWillV1DocumentCodecWorkerResponseCorrelation(value);
  let message;
  try {
    message =
      parseStudioFirstPartyWillV1DocumentCodecWorkerRunMessage(value);
  } catch (error) {
    if (requestId === null) return null;
    return Object.freeze({
      response:
        createStudioFirstPartyWillV1DocumentCodecWorkerProtocolFailure(
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
      [STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER],
    );
    if (!result.ok) {
      return Object.freeze({
        response:
          createStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(
            message.requestId,
            "provider-failure",
            result.code,
          ),
        transfer: Object.freeze([]),
      });
    }

    const response:
      StudioFirstPartyWillV1DocumentCodecWorkerSuccessMessage = {
        type: "studio-first-party-will-v1-document-codec/success",
        version:
          STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        bytes: ownedArrayBuffer(result.bytes),
        receipt: result.receipt,
      };
    return Object.freeze({
      response,
      transfer: Object.freeze(
        studioFirstPartyWillV1DocumentCodecWorkerSuccessTransfers(response),
      ),
    });
  } catch {
    return Object.freeze({
      response:
        createStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(
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
  scope: StudioFirstPartyWillV1DocumentCodecDedicatedWorkerScope,
  response:
    StudioFirstPartyWillV1DocumentCodecWorkerResponseMessage,
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

export function installStudioFirstPartyWillV1DocumentCodecWorkerRuntime(
  scope: StudioFirstPartyWillV1DocumentCodecDedicatedWorkerScope,
): void {
  let acceptedJob = false;
  scope.onmessage = (event) => {
    const requestId =
      studioFirstPartyWillV1DocumentCodecWorkerResponseCorrelation(
        event.data,
      );
    if (acceptedJob) {
      if (requestId !== null) {
        postResponseOrClose(
          scope,
          createStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(
            requestId,
            "protocol-error",
          ),
          [],
        );
      }
      return;
    }
    acceptedJob = true;
    void executeStudioFirstPartyWillV1DocumentCodecWorkerMessage(
      event.data,
    ).then(
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
            createStudioFirstPartyWillV1DocumentCodecWorkerFailureMessage(
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
  installStudioFirstPartyWillV1DocumentCodecWorkerRuntime(
    globalThis as unknown as
      StudioFirstPartyWillV1DocumentCodecDedicatedWorkerScope,
  );
}
