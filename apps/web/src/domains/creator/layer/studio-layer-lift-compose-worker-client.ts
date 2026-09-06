import { sha256HexPortable } from "../studio-sha256";

import {
  verifyStudioLayerLiftArtifactPairReceipt,
} from "./studio-layer-lift-artifact";
import {
  StudioLayerLiftComposeWorkerProtocolError,
  createStudioLayerLiftComposeWorkerRequest,
  isStudioLayerLiftComposeWorkerResponse,
  studioLayerLiftComposeWorkerRequestTransfers,
  studioLayerLiftComposeWorkerResponseIdentity,
} from "./studio-layer-lift-compose-worker-protocol";
import {
  isTrustedStudioLayerLiftCompositionReceipt,
  parseStudioLayerLiftCompositionReceipt,
} from "./studio-layer-lift-composition-receipt";
import {
  STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM,
  STUDIO_LAYER_LIFT_COMPOSITOR_ID,
  STUDIO_LAYER_LIFT_COMPOSITOR_VERSION,
  StudioLayerLiftCompositorError,
  admitStudioLayerLiftCompositorInput,
  calculateStudioLayerLiftCompositorParitySha256,
} from "./studio-layer-lift-compositor";

import type {
  StudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import type {
  StudioLayerLiftComposeWorkerRequest,
  StudioLayerLiftComposeWorkerResponse,
  StudioLayerLiftComposeWorkerResult,
} from "./studio-layer-lift-compose-worker-protocol";
import type {
  StudioLayerLiftCompositionReceipt,
} from "./studio-layer-lift-composition-receipt";
import type {
  StudioLayerLiftCompositorDiagnostics,
  StudioLayerLiftCompositorInput,
  StudioLayerLiftCompositorMask,
  StudioLayerLiftCompositorOwnedInput,
  StudioLayerLiftCompositorPlane,
} from "./studio-layer-lift-compositor";
import type {
  StudioSceneLayerLiftSha256,
} from "./studio-layer-lift-contract";

export const STUDIO_LAYER_LIFT_COMPOSE_WORKER_DEFAULT_TIMEOUT_MS = 45_000;
export const STUDIO_LAYER_LIFT_COMPOSE_WORKER_MAX_TIMEOUT_MS = 120_000;

export type StudioLayerLiftComposeWorkerClientErrorCode =
  | "aborted"
  | "artifact-invalid"
  | "budget-exceeded"
  | "encode-failed"
  | "encode-unavailable"
  | "invalid-request"
  | "provenance-mismatch"
  | "worker-disposed"
  | "worker-post-failed"
  | "worker-protocol"
  | "worker-runtime"
  | "worker-timeout"
  | "worker-unavailable";

export class StudioLayerLiftComposeWorkerClientError extends Error {
  constructor(
    readonly code: StudioLayerLiftComposeWorkerClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = code === "aborted"
      ? "AbortError"
      : "StudioLayerLiftComposeWorkerClientError";
  }
}

export interface StudioLayerLiftComposeWorkerLike {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror:
    | ((event: {
        readonly error?: unknown;
        readonly message?: string;
        preventDefault?(): void;
      }) => void)
    | null;
  onmessageerror:
    | ((event: { preventDefault?(): void }) => void)
    | null;
  postMessage(
    message: StudioLayerLiftComposeWorkerRequest,
    transfer: Transferable[],
  ): void;
  terminate(): void;
}

export type StudioLayerLiftComposeWorkerFactory =
  () => StudioLayerLiftComposeWorkerLike | null;

export interface StudioLayerLiftComposeWorkerClientOptions {
  readonly workerFactory?: StudioLayerLiftComposeWorkerFactory | null;
  readonly timeoutMs?: number;
}

export interface StudioLayerLiftComposeWorkerRunOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface StudioLayerLiftTrustedWorkerComposition {
  readonly requestId: string;
  readonly sourceId: string;
  readonly width: number;
  readonly height: number;
  readonly backgroundRgba: StudioLayerLiftCompositorPlane;
  readonly foregroundRgba: StudioLayerLiftCompositorPlane;
  readonly removalMask: StudioLayerLiftCompositorMask;
  readonly diagnostics: StudioLayerLiftCompositorDiagnostics;
  readonly artifacts: StudioLayerLiftTrustedArtifactPair;
  readonly compositionReceipt: StudioLayerLiftCompositionReceipt;
}

interface ActiveJob {
  readonly worker: StudioLayerLiftComposeWorkerLike;
  readonly generation: number;
  readonly sequence: number;
  readonly authority: StudioLayerLiftCompositorOwnedInput;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: StudioLayerLiftTrustedWorkerComposition) => void;
  readonly reject: (reason: unknown) => void;
  readonly onAbort: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  verifying: boolean;
}

const TRUSTED_WORKER_RESULTS = new WeakSet<object>();

export function isStudioLayerLiftTrustedWorkerComposition(
  value: unknown,
): value is StudioLayerLiftTrustedWorkerComposition {
  return (
    typeof value === "object"
    && value !== null
    && TRUSTED_WORKER_RESULTS.has(value)
  );
}

export function createStudioLayerLiftComposeModuleWorker():
  StudioLayerLiftComposeWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(
    new URL("./studio-layer-lift-compose.worker.ts", import.meta.url),
    {
      type: "module",
      name: "toonspectrum-layer-lift-compose",
    },
  ) as unknown as StudioLayerLiftComposeWorkerLike;
}

function normalizeTimeout(value: number | undefined): number {
  const timeout = value ?? STUDIO_LAYER_LIFT_COMPOSE_WORKER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeout)
    || timeout < 1
    || timeout > STUDIO_LAYER_LIFT_COMPOSE_WORKER_MAX_TIMEOUT_MS
  ) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "invalid-request",
      `timeoutMs must be an integer between 1 and ${
        STUDIO_LAYER_LIFT_COMPOSE_WORKER_MAX_TIMEOUT_MS
      }.`,
    );
  }
  return timeout;
}

function abortError(message: string): StudioLayerLiftComposeWorkerClientError {
  return new StudioLayerLiftComposeWorkerClientError("aborted", message);
}

function hashBytes(
  bytes: Uint8Array<ArrayBuffer> | Uint8ClampedArray<ArrayBuffer>,
): StudioSceneLayerLiftSha256 {
  return `sha256:${sha256HexPortable(new Uint8Array(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ))}`;
}

function sameProviderLayers(
  authority: StudioLayerLiftCompositorOwnedInput,
  receipt: StudioLayerLiftCompositionReceipt,
): boolean {
  if (authority.providerLayers.length !== receipt.providerLayers.length) {
    return false;
  }
  return authority.providerLayers.every((expected, index) => {
    const actual = receipt.providerLayers[index];
    return (
      actual?.layerId === expected.layerId
      && actual.role === expected.role
      && actual.order === expected.order
      && actual.rgba.sha256 === expected.rgbaSha256
      && actual.mask.sha256 === expected.maskSha256
    );
  });
}

function hasExpectedContributorPartition(
  authority: StudioLayerLiftCompositorOwnedInput,
  receipt: StudioLayerLiftCompositionReceipt,
): boolean {
  const expectedBackground = authority.providerLayers
    .filter((layer) => layer.layerId !== authority.foregroundLayerId)
    .map((layer) => layer.layerId);
  const actualBackground = receipt.background.contributorLayerIds;
  const actualForeground = receipt.foreground.contributorLayerIds;
  return (
    actualForeground.length === 1
    && actualForeground[0] === authority.foregroundLayerId
    && actualBackground.length === expectedBackground.length
    && expectedBackground.every(
      (layerId, index) => actualBackground[index] === layerId,
    )
  );
}

function plane(
  bytes: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  expectedSha256: StudioSceneLayerLiftSha256,
): StudioLayerLiftCompositorPlane {
  if (hashBytes(bytes) !== expectedSha256) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "worker-protocol",
      "Layer Lift Worker RGBA hash does not match its diagnostics.",
    );
  }
  return Object.freeze({
    width,
    height,
    byteLength: bytes.byteLength,
    sha256: expectedSha256,
    bytes,
  });
}

function maskPlane(
  bytes: Uint8Array<ArrayBuffer>,
  width: number,
  height: number,
  expectedSha256: StudioSceneLayerLiftSha256,
): StudioLayerLiftCompositorMask {
  if (hashBytes(bytes) !== expectedSha256) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "worker-protocol",
      "Layer Lift Worker mask hash does not match its diagnostics.",
    );
  }
  return Object.freeze({
    width,
    height,
    byteLength: bytes.byteLength,
    sha256: expectedSha256,
    bytes,
  });
}

async function admitWorkerResult(
  response: StudioLayerLiftComposeWorkerResult,
  authority: StudioLayerLiftCompositorOwnedInput,
): Promise<StudioLayerLiftTrustedWorkerComposition> {
  if (
    response.requestId !== authority.requestId
    || response.sourceId !== authority.sourceId
    || response.width !== authority.width
    || response.height !== authority.height
    || response.backgroundOutputId !== authority.backgroundOutputId
    || response.foregroundOutputId !== authority.foregroundOutputId
  ) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "provenance-mismatch",
      "Layer Lift Worker result belongs to another source authority.",
    );
  }
  // Snapshot every transferred buffer before the first asynchronous SHA-256
  // verification. Host shims cannot race a same-length mutation into the later
  // live/commit result.
  const backgroundRgbaBytes = new Uint8ClampedArray(
    ArrayBuffer.prototype.slice.call(response.backgroundRgbaBuffer, 0),
  );
  const foregroundRgbaBytes = new Uint8ClampedArray(
    ArrayBuffer.prototype.slice.call(response.foregroundRgbaBuffer, 0),
  );
  const removalMaskBytes = new Uint8Array(
    ArrayBuffer.prototype.slice.call(response.removalMaskBuffer, 0),
  );
  const backgroundPngBytes = ArrayBuffer.prototype.slice.call(
    response.backgroundPngBuffer,
    0,
  ) as ArrayBuffer;
  const foregroundPngBytes = ArrayBuffer.prototype.slice.call(
    response.foregroundPngBuffer,
    0,
  ) as ArrayBuffer;
  const diagnostics = Object.freeze({ ...response.diagnostics });

  if (
    diagnostics.algorithm !== STUDIO_LAYER_LIFT_COMPOSITOR_ALGORITHM
    || diagnostics.sourceRgbaSha256 !== authority.sourceSha256
    || diagnostics.foregroundMaskSha256 !== authority.foregroundMaskSha256
    || diagnostics.fillTilePixels !== authority.fillTilePixels
    || hashBytes(removalMaskBytes) !== authority.foregroundMaskSha256
  ) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "provenance-mismatch",
      "Layer Lift Worker diagnostics do not match the admitted source authority.",
    );
  }

  const backgroundRgba = plane(
    backgroundRgbaBytes,
    authority.width,
    authority.height,
    diagnostics.backgroundRgbaSha256,
  );
  const foregroundRgba = plane(
    foregroundRgbaBytes,
    authority.width,
    authority.height,
    diagnostics.foregroundRgbaSha256,
  );
  const removalMask = maskPlane(
    removalMaskBytes,
    authority.width,
    authority.height,
    diagnostics.foregroundMaskSha256,
  );
  const expectedParity = calculateStudioLayerLiftCompositorParitySha256(
    authority,
    backgroundRgba.sha256,
    foregroundRgba.sha256,
  );
  if (diagnostics.paritySha256 !== expectedParity) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "provenance-mismatch",
      "Layer Lift Worker live/commit parity authority is invalid.",
    );
  }

  const parsedComposition = parseStudioLayerLiftCompositionReceipt(
    response.compositionReceipt,
  );
  if (
    !parsedComposition.ok
    || !isTrustedStudioLayerLiftCompositionReceipt(parsedComposition.value)
  ) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "provenance-mismatch",
      "Layer Lift Worker composition receipt is invalid.",
    );
  }
  const compositionReceipt = parsedComposition.value;
  if (
    compositionReceipt.requestId !== authority.requestId
    || compositionReceipt.sourceSha256 !== authority.sourceSha256
    || compositionReceipt.providerReceiptSha256
      !== authority.providerReceiptSha256
    || compositionReceipt.compositor.id !== STUDIO_LAYER_LIFT_COMPOSITOR_ID
    || compositionReceipt.compositor.version
      !== STUDIO_LAYER_LIFT_COMPOSITOR_VERSION
    || !sameProviderLayers(authority, compositionReceipt)
    || !hasExpectedContributorPartition(authority, compositionReceipt)
  ) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "provenance-mismatch",
      "Layer Lift Worker composition receipt belongs to another authority.",
    );
  }

  let artifacts: StudioLayerLiftTrustedArtifactPair;
  try {
    artifacts = await verifyStudioLayerLiftArtifactPairReceipt({
      requestId: authority.requestId,
      sourceId: authority.sourceId,
      sourceWidth: authority.width,
      sourceHeight: authority.height,
      backgroundOutputId: authority.backgroundOutputId,
      foregroundOutputId: authority.foregroundOutputId,
      receipt: response.artifactReceipt,
      backgroundBytes: backgroundPngBytes,
      foregroundBytes: foregroundPngBytes,
    });
  } catch {
    throw new StudioLayerLiftComposeWorkerClientError(
      "artifact-invalid",
      "Layer Lift Worker PNG artifacts failed main-realm verification.",
    );
  }
  if (
    compositionReceipt.background.outputId
      !== authority.backgroundOutputId
    || compositionReceipt.foreground.outputId
      !== authority.foregroundOutputId
    || compositionReceipt.background.artifactSha256
      !== artifacts.background.sha256
    || compositionReceipt.foreground.artifactSha256
      !== artifacts.foreground.sha256
  ) {
    throw new StudioLayerLiftComposeWorkerClientError(
      "provenance-mismatch",
      "Layer Lift PNG artifacts are not bound to the composition receipt.",
    );
  }

  const result: StudioLayerLiftTrustedWorkerComposition = Object.freeze({
    requestId: authority.requestId,
    sourceId: authority.sourceId,
    width: authority.width,
    height: authority.height,
    backgroundRgba,
    foregroundRgba,
    removalMask,
    diagnostics,
    artifacts,
    compositionReceipt,
  });
  TRUSTED_WORKER_RESULTS.add(result);
  return result;
}

/**
 * Capacity-one, latest-request-wins client. Caller input is never detached:
 * request creation owns source/mask snapshots and transfers only those copies.
 * Abort, timeout, supersession and malformed output terminate the Worker realm.
 */
export class StudioLayerLiftComposeWorkerClient {
  readonly #workerFactory: StudioLayerLiftComposeWorkerFactory | null;
  readonly #defaultTimeoutMs: number;
  #worker: StudioLayerLiftComposeWorkerLike | null = null;
  #workerGeneration = 0;
  #nextGeneration = 1;
  #nextSequence = 1;
  #active: ActiveJob | null = null;
  #disposed = false;

  constructor(options: StudioLayerLiftComposeWorkerClientOptions = {}) {
    this.#workerFactory = options.workerFactory === undefined
      ? createStudioLayerLiftComposeModuleWorker
      : options.workerFactory;
    this.#defaultTimeoutMs = normalizeTimeout(options.timeoutMs);
  }

  get activeCount(): 0 | 1 {
    return this.#active === null ? 0 : 1;
  }

  get currentGeneration(): number {
    return this.#workerGeneration;
  }

  run(
    input: StudioLayerLiftCompositorInput,
    options: StudioLayerLiftComposeWorkerRunOptions = {},
  ): Promise<StudioLayerLiftTrustedWorkerComposition> {
    if (this.#disposed) {
      return Promise.reject(
        new StudioLayerLiftComposeWorkerClientError(
          "worker-disposed",
          "Layer Lift compositor Worker client has been disposed.",
        ),
      );
    }
    if (options.signal?.aborted) {
      return Promise.reject(
        abortError("Layer Lift compositor request was aborted."),
      );
    }

    let authority: StudioLayerLiftCompositorOwnedInput;
    let timeoutMs: number;
    try {
      authority = admitStudioLayerLiftCompositorInput(input);
      timeoutMs = normalizeTimeout(options.timeoutMs ?? this.#defaultTimeoutMs);
    } catch (error) {
      if (error instanceof StudioLayerLiftComposeWorkerClientError) {
        return Promise.reject(error);
      }
      return Promise.reject(
        new StudioLayerLiftComposeWorkerClientError(
          error instanceof StudioLayerLiftCompositorError
            && error.code === "budget-exceeded"
            ? "budget-exceeded"
            : "invalid-request",
          "Layer Lift compositor request failed admission.",
        ),
      );
    }

    if (this.#active) {
      this.#rejectActive(
        abortError(
          "Layer Lift compositor request was superseded by a newer request.",
        ),
      );
    }

    let worker: StudioLayerLiftComposeWorkerLike;
    try {
      worker = this.#ensureWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    const generation = this.#workerGeneration;
    const sequence = this.#allocateSequence();
    let request: StudioLayerLiftComposeWorkerRequest;
    try {
      request = createStudioLayerLiftComposeWorkerRequest(
        authority,
        generation,
        sequence,
      );
    } catch (error) {
      this.#terminateWorker(worker);
      return Promise.reject(
        new StudioLayerLiftComposeWorkerClientError(
          error instanceof StudioLayerLiftComposeWorkerProtocolError
            && error.code === "budget-exceeded"
            ? "budget-exceeded"
            : "invalid-request",
          "Layer Lift compositor request could not be serialized.",
        ),
      );
    }

    return new Promise<StudioLayerLiftTrustedWorkerComposition>(
      (resolve, reject) => {
        const active: ActiveJob = {
          worker,
          generation,
          sequence,
          authority,
          signal: options.signal,
          resolve,
          reject,
          timer: null,
          verifying: false,
          onAbort: () => {
            if (this.#active !== active) return;
            this.#rejectActive(
              abortError("Layer Lift compositor request was aborted."),
            );
          },
        };
        this.#active = active;
        options.signal?.addEventListener("abort", active.onAbort, {
          once: true,
        });
        if (options.signal?.aborted) {
          active.onAbort();
          return;
        }
        active.timer = setTimeout(() => {
          if (this.#active !== active) return;
          this.#rejectActive(
            new StudioLayerLiftComposeWorkerClientError(
              "worker-timeout",
              "Layer Lift compositor Worker timed out.",
            ),
          );
        }, timeoutMs);
        try {
          worker.postMessage(
            request,
            [...studioLayerLiftComposeWorkerRequestTransfers(request)],
          );
        } catch {
          this.#rejectActive(
            new StudioLayerLiftComposeWorkerClientError(
              "worker-post-failed",
              "Layer Lift compositor request could not be transferred.",
            ),
          );
        }
      },
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#active) {
      this.#rejectActive(
        new StudioLayerLiftComposeWorkerClientError(
          "worker-disposed",
          "Layer Lift compositor Worker client was disposed.",
        ),
      );
      return;
    }
    this.#terminateWorker();
  }

  #allocateGeneration(): number {
    const generation = this.#nextGeneration;
    this.#nextGeneration =
      generation >= MAXIMUM_CLIENT_ID ? 1 : generation + 1;
    return generation;
  }

  #allocateSequence(): number {
    const sequence = this.#nextSequence;
    this.#nextSequence =
      sequence >= MAXIMUM_CLIENT_ID ? 1 : sequence + 1;
    return sequence;
  }

  #ensureWorker(): StudioLayerLiftComposeWorkerLike {
    if (this.#worker) return this.#worker;
    if (!this.#workerFactory) {
      throw new StudioLayerLiftComposeWorkerClientError(
        "worker-unavailable",
        "Layer Lift compositor Worker is unavailable.",
      );
    }
    let worker: StudioLayerLiftComposeWorkerLike | null;
    try {
      worker = this.#workerFactory();
    } catch {
      worker = null;
    }
    if (!worker) {
      throw new StudioLayerLiftComposeWorkerClientError(
        "worker-unavailable",
        "Layer Lift compositor Worker could not be created.",
      );
    }
    const generation = this.#allocateGeneration();
    this.#worker = worker;
    this.#workerGeneration = generation;
    worker.onmessage = (event) => {
      this.#onMessage(worker, generation, event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      if (
        this.#worker !== worker
        || this.#workerGeneration !== generation
      ) {
        return;
      }
      if (this.#active?.worker === worker) {
        this.#rejectActive(
          new StudioLayerLiftComposeWorkerClientError(
            "worker-runtime",
            event.message || "Layer Lift compositor Worker crashed.",
          ),
        );
      } else {
        this.#terminateWorker(worker);
      }
    };
    worker.onmessageerror = (event) => {
      event.preventDefault?.();
      if (
        this.#worker !== worker
        || this.#workerGeneration !== generation
      ) {
        return;
      }
      if (this.#active?.worker === worker) {
        this.#rejectActive(
          new StudioLayerLiftComposeWorkerClientError(
            "worker-protocol",
            "Layer Lift compositor response could not be cloned.",
          ),
        );
      } else {
        this.#terminateWorker(worker);
      }
    };
    return worker;
  }

  #onMessage(
    worker: StudioLayerLiftComposeWorkerLike,
    generation: number,
    value: unknown,
  ): void {
    if (
      this.#worker !== worker
      || this.#workerGeneration !== generation
    ) {
      return;
    }
    const active = this.#active;
    if (
      !active
      || active.worker !== worker
      || active.generation !== generation
    ) {
      return;
    }
    const identity = studioLayerLiftComposeWorkerResponseIdentity(value);
    if (
      identity
      && (
        identity.generation !== active.generation
        || identity.sequence !== active.sequence
      )
    ) {
      return;
    }
    if (!identity || !isStudioLayerLiftComposeWorkerResponse(value)) {
      this.#rejectActive(
        new StudioLayerLiftComposeWorkerClientError(
          "worker-protocol",
          "Layer Lift compositor Worker returned a malformed response.",
        ),
      );
      return;
    }
    const response: StudioLayerLiftComposeWorkerResponse = value;
    if (response.kind === "studio-layer-lift-compose/error") {
      const code: StudioLayerLiftComposeWorkerClientErrorCode =
        response.code === "internal" || response.code === "protocol"
          ? "worker-runtime"
          : response.code === "invalid-input"
            ? "invalid-request"
            : response.code;
      this.#rejectActive(
        new StudioLayerLiftComposeWorkerClientError(
          code,
          "Layer Lift compositor Worker failed closed.",
        ),
      );
      return;
    }
    if (active.verifying) {
      this.#rejectActive(
        new StudioLayerLiftComposeWorkerClientError(
          "worker-protocol",
          "Layer Lift compositor Worker returned duplicate results.",
        ),
      );
      return;
    }
    active.verifying = true;
    void admitWorkerResult(response, active.authority)
      .then((result) => {
        if (this.#active !== active) return;
        this.#resolveActive(result);
      })
      .catch((error) => {
        if (this.#active !== active) return;
        this.#rejectActive(
          error instanceof StudioLayerLiftComposeWorkerClientError
            ? error
            : new StudioLayerLiftComposeWorkerClientError(
                "worker-protocol",
                "Layer Lift compositor result could not be admitted.",
              ),
        );
      });
  }

  #cleanupActive(active: ActiveJob): void {
    if (active.timer !== null) clearTimeout(active.timer);
    active.signal?.removeEventListener("abort", active.onAbort);
    if (this.#active === active) this.#active = null;
  }

  #resolveActive(result: StudioLayerLiftTrustedWorkerComposition): void {
    const active = this.#active;
    if (!active) return;
    this.#cleanupActive(active);
    active.resolve(result);
  }

  #rejectActive(error: unknown): void {
    const active = this.#active;
    if (!active) return;
    this.#cleanupActive(active);
    this.#terminateWorker(active.worker);
    active.reject(error);
  }

  #terminateWorker(
    expected: StudioLayerLiftComposeWorkerLike | null = this.#worker,
  ): void {
    const worker = this.#worker;
    if (!worker || (expected !== null && worker !== expected)) return;
    this.#worker = null;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    try {
      worker.terminate();
    } catch {
      // Termination remains the fail-closed authority even for a host shim.
    }
  }
}

const MAXIMUM_CLIENT_ID = 0x7fff_ffff;
