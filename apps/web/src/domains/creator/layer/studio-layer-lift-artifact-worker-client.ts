import {
  StudioLayerLiftArtifactError,
  verifyStudioLayerLiftArtifactPairReceipt,
  type StudioLayerLiftArtifactPairInput,
  type StudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import {
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
  STUDIO_LAYER_LIFT_ARTIFACT_WORKER_REQUEST_KIND,
  getStudioLayerLiftArtifactWorkerRequestTransferList,
  isStudioLayerLiftArtifactWorkerRequest,
  isStudioLayerLiftArtifactWorkerResponse,
  type StudioLayerLiftArtifactWorkerErrorCode,
  type StudioLayerLiftArtifactWorkerRequest,
} from "./studio-layer-lift-artifact-worker-protocol";

export const STUDIO_LAYER_LIFT_ARTIFACT_WORKER_DEFAULT_TIMEOUT_MS = 15_000;
export const STUDIO_LAYER_LIFT_ARTIFACT_WORKER_MAX_TIMEOUT_MS = 60_000;

export type StudioLayerLiftArtifactWorkerClientErrorCode =
  | StudioLayerLiftArtifactWorkerErrorCode
  | "post-failed"
  | "timeout"
  | "worker-failed"
  | "worker-unavailable";

export class StudioLayerLiftArtifactWorkerClientError extends Error {
  readonly code: StudioLayerLiftArtifactWorkerClientErrorCode;

  constructor(
    code: StudioLayerLiftArtifactWorkerClientErrorCode,
    message: string = code,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name =
      code === "aborted"
        ? "AbortError"
        : code === "timeout"
          ? "TimeoutError"
          : "StudioLayerLiftArtifactWorkerClientError";
    this.code = code;
  }
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioLayerLiftArtifactWorkerLike {
  postMessage(
    message: StudioLayerLiftArtifactWorkerRequest,
    transfer: readonly Transferable[],
  ): void;
  addEventListener(
    type: "message",
    listener: (event: WorkerMessageEventLike) => void,
  ): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  removeEventListener(
    type: "message",
    listener: (event: WorkerMessageEventLike) => void,
  ): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  terminate(): void;
}

export interface StudioLayerLiftArtifactWorkerClientOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  readonly workerFactory?: () => StudioLayerLiftArtifactWorkerLike | null;
}

interface ResponseIdentity {
  readonly generation: number;
  readonly sequence: number;
}

interface RequestAuthority extends ResponseIdentity {
  readonly requestId: string;
  readonly sourceId: string;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly backgroundOutputId: string;
  readonly foregroundOutputId: string;
}

const MAXIMUM_SEQUENCE = 0x7fff_ffff;
let nextGeneration = 1;
let nextSequence = 1;

function allocateGeneration(): number {
  const value = nextGeneration;
  nextGeneration = value >= MAXIMUM_SEQUENCE ? 1 : value + 1;
  return value;
}

function allocateSequence(): number {
  const value = nextSequence;
  nextSequence = value >= MAXIMUM_SEQUENCE ? 1 : value + 1;
  return value;
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return STUDIO_LAYER_LIFT_ARTIFACT_WORKER_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(
    STUDIO_LAYER_LIFT_ARTIFACT_WORKER_MAX_TIMEOUT_MS,
    Math.max(1, Math.trunc(value)),
  );
}

function createModuleWorker(): StudioLayerLiftArtifactWorkerLike | null {
  if (typeof Worker !== "function") {
    return null;
  }
  return new Worker(
    new URL("./studio-layer-lift-artifact.worker.ts", import.meta.url),
    {
      type: "module",
      name: "toonspectrum-layer-lift-artifact",
    },
  );
}

function isPositiveProtocolSequence(value: unknown): value is number {
  return (
    Number.isSafeInteger(value) &&
    Number(value) > 0 &&
    Number(value) <= MAXIMUM_SEQUENCE
  );
}

function responseIdentity(value: unknown): ResponseIdentity | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const generationDescriptor = Object.getOwnPropertyDescriptor(
    value,
    "generation",
  );
  const sequenceDescriptor = Object.getOwnPropertyDescriptor(value, "sequence");
  const generation = generationDescriptor?.value;
  const sequence = sequenceDescriptor?.value;
  return isPositiveProtocolSequence(generation) &&
    isPositiveProtocolSequence(sequence)
    ? { generation, sequence }
    : null;
}

function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Cleanup cannot change the already selected terminal result.
  }
}

function makeRequest(
  input: StudioLayerLiftArtifactPairInput,
  authority: ResponseIdentity,
): StudioLayerLiftArtifactWorkerRequest {
  const backgroundBytes = input.background.bytes;
  const foregroundBytes = input.foreground.bytes;
  if (
    !(backgroundBytes instanceof ArrayBuffer) ||
    !(foregroundBytes instanceof ArrayBuffer)
  ) {
    throw new StudioLayerLiftArtifactWorkerClientError(
      "protocol",
      "Worker admission requires exclusively owned ArrayBuffer inputs.",
    );
  }

  const request: StudioLayerLiftArtifactWorkerRequest = {
    version: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_PROTOCOL_VERSION,
    kind: STUDIO_LAYER_LIFT_ARTIFACT_WORKER_REQUEST_KIND,
    generation: authority.generation,
    sequence: authority.sequence,
    requestId: input.requestId,
    sourceId: input.sourceId,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
    backgroundOutputId: input.background.outputId,
    foregroundOutputId: input.foreground.outputId,
    backgroundByteLength: backgroundBytes.byteLength,
    foregroundByteLength: foregroundBytes.byteLength,
    backgroundBytes,
    foregroundBytes,
  };
  if (!isStudioLayerLiftArtifactWorkerRequest(request)) {
    throw new StudioLayerLiftArtifactWorkerClientError(
      "protocol",
      "Layer-lift artifact input failed worker protocol validation.",
    );
  }
  return request;
}

function toClientError(
  error: unknown,
): StudioLayerLiftArtifactWorkerClientError {
  if (error instanceof StudioLayerLiftArtifactWorkerClientError) {
    return error;
  }
  if (error instanceof StudioLayerLiftArtifactError) {
    return new StudioLayerLiftArtifactWorkerClientError(
      error.code,
      error.message,
      { cause: error },
    );
  }
  return new StudioLayerLiftArtifactWorkerClientError(
    "protocol",
    "The layer-lift artifact response could not be trusted.",
    { cause: error },
  );
}

/**
 * Transfers ownership of both input ArrayBuffers to a fresh module Worker.
 *
 * Once postMessage succeeds, callers must treat the input buffers as consumed.
 * A successful result returns newly owned buffers whose receipt is re-hashed in
 * the receiving realm before trust is granted.
 */
export function admitStudioLayerLiftArtifactPairInWorker(
  input: StudioLayerLiftArtifactPairInput,
  options: StudioLayerLiftArtifactWorkerClientOptions = {},
): Promise<StudioLayerLiftTrustedArtifactPair> {
  if (options.signal?.aborted) {
    return Promise.reject(
      new StudioLayerLiftArtifactWorkerClientError(
        "aborted",
        "Layer-lift artifact admission was aborted before ownership transfer.",
      ),
    );
  }

  const generation = allocateGeneration();
  const sequence = allocateSequence();
  let request: StudioLayerLiftArtifactWorkerRequest;
  try {
    request = makeRequest(input, { generation, sequence });
  } catch (error) {
    return Promise.reject(toClientError(error));
  }

  const authority: RequestAuthority = Object.freeze({
    generation,
    sequence,
    requestId: request.requestId,
    sourceId: request.sourceId,
    sourceWidth: request.sourceWidth,
    sourceHeight: request.sourceHeight,
    backgroundOutputId: request.backgroundOutputId,
    foregroundOutputId: request.foregroundOutputId,
  });

  let worker: StudioLayerLiftArtifactWorkerLike | null;
  try {
    worker = (options.workerFactory ?? createModuleWorker)();
  } catch (error) {
    return Promise.reject(
      new StudioLayerLiftArtifactWorkerClientError(
        "worker-unavailable",
        "The layer-lift artifact worker could not be created.",
        { cause: error },
      ),
    );
  }
  if (worker === null) {
    return Promise.reject(
      new StudioLayerLiftArtifactWorkerClientError(
        "worker-unavailable",
        "The layer-lift artifact worker is unavailable in this runtime.",
      ),
    );
  }

  const ownedWorker = worker;
  const timeoutMs = boundedTimeout(options.timeoutMs);
  return new Promise<StudioLayerLiftTrustedArtifactPair>((resolve, reject) => {
    let settled = false;
    let responseAccepted = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeout !== undefined) {
        clearTimeout(timeout);
        timeout = undefined;
      }
      options.signal?.removeEventListener("abort", handleAbort);
      ownedWorker.removeEventListener("message", handleMessage);
      ownedWorker.removeEventListener("error", handleWorkerFailure);
      ownedWorker.removeEventListener("messageerror", handleWorkerFailure);
      safely(() => ownedWorker.terminate());
    };

    const settleRejected = (
      error: StudioLayerLiftArtifactWorkerClientError,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };

    const settleResolved = (result: StudioLayerLiftTrustedArtifactPair) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(result);
    };

    function handleAbort(): void {
      settleRejected(
        new StudioLayerLiftArtifactWorkerClientError(
          "aborted",
          "Layer-lift artifact admission was aborted.",
        ),
      );
    }

    function handleWorkerFailure(event: WorkerErrorEventLike): void {
      event.preventDefault?.();
      settleRejected(
        new StudioLayerLiftArtifactWorkerClientError(
          "worker-failed",
          "The layer-lift artifact worker failed.",
        ),
      );
    }

    function handleMessage(event: WorkerMessageEventLike): void {
      const identity = responseIdentity(event.data);
      if (identity === null) {
        settleRejected(
          new StudioLayerLiftArtifactWorkerClientError(
            "protocol",
            "The layer-lift artifact worker sent a malformed response.",
          ),
        );
        return;
      }

      if (
        identity.generation !== authority.generation ||
        identity.sequence !== authority.sequence
      ) {
        // A response owned by an earlier request has no authority over this job.
        return;
      }

      // A current-identity response consumes this request's one response authority before async
      // WebCrypto verification begins. A second same-identity message cannot race to become the
      // terminal result while the first digest is pending.
      if (responseAccepted) {
        return;
      }
      responseAccepted = true;

      if (!isStudioLayerLiftArtifactWorkerResponse(event.data)) {
        settleRejected(
          new StudioLayerLiftArtifactWorkerClientError(
            "protocol",
            "The layer-lift artifact worker response failed protocol validation.",
          ),
        );
        return;
      }

      if (event.data.kind === "studio-layer-lift-artifact/error") {
        settleRejected(
          new StudioLayerLiftArtifactWorkerClientError(
            event.data.code,
            event.data.message,
          ),
        );
        return;
      }

      void verifyStudioLayerLiftArtifactPairReceipt({
          requestId: authority.requestId,
          sourceId: authority.sourceId,
          sourceWidth: authority.sourceWidth,
          sourceHeight: authority.sourceHeight,
          backgroundOutputId: authority.backgroundOutputId,
          foregroundOutputId: authority.foregroundOutputId,
          receipt: event.data.receipt,
          backgroundBytes: event.data.backgroundBytes,
          foregroundBytes: event.data.foregroundBytes,
        }).then(settleResolved, (error: unknown) => {
          settleRejected(toClientError(error));
        });
    }

    ownedWorker.addEventListener("message", handleMessage);
    ownedWorker.addEventListener("error", handleWorkerFailure);
    ownedWorker.addEventListener("messageerror", handleWorkerFailure);
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }

    timeout = setTimeout(() => {
      settleRejected(
        new StudioLayerLiftArtifactWorkerClientError(
          "timeout",
          "Layer-lift artifact admission timed out.",
        ),
      );
    }, timeoutMs);

    try {
      ownedWorker.postMessage(
        request,
        getStudioLayerLiftArtifactWorkerRequestTransferList(request),
      );
    } catch (error) {
      settleRejected(
        new StudioLayerLiftArtifactWorkerClientError(
          "post-failed",
          "Layer-lift artifact ownership transfer failed.",
          { cause: error },
        ),
      );
    }
  });
}
