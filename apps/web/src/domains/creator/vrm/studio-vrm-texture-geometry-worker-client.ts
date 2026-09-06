import {
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_DEFAULT_UV_EPSILON,
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_EPSILON,
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES,
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TRIANGLES,
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES,
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MIN_EPSILON,
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
  computeStudioVrmTextureGeometryWorkerTopology,
  hasValidStudioVrmTextureGeometryWorkerTopologyNumbers,
  isStudioVrmTextureGeometryWorkerResponse,
  studioVrmTextureGeometryWorkerRequestTransfers,
  type StudioVrmTextureGeometryWorkerFailureCode,
  type StudioVrmTextureGeometryWorkerFloatArray,
  type StudioVrmTextureGeometryWorkerRequest,
  type StudioVrmTextureGeometryWorkerTopology,
} from "./studio-vrm-texture-geometry-worker-protocol";

export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_DEFAULT_TIMEOUT_MS = 30_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TIMEOUT_MS = 120_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_DIRECT_MAX_TRIANGLES = 4_096;
export const STUDIO_VRM_TEXTURE_GEOMETRY_DIRECT_MAX_INPUT_BYTES = 1_048_576;

export type StudioVrmTextureGeometryExecutionBackend = "worker" | "direct";

export type StudioVrmTextureGeometryFloatSource =
  | Float32Array<ArrayBufferLike>
  | Float64Array<ArrayBufferLike>;

export type StudioVrmTextureGeometryIndexSource =
  | Uint8Array<ArrayBufferLike>
  | Uint16Array<ArrayBufferLike>
  | Uint32Array<ArrayBufferLike>;

export interface StudioVrmTextureGeometryWorkerInput {
  /** Packed XYZ values. Interleaved BufferAttributes must be packed by the integration adapter. */
  readonly positions: StudioVrmTextureGeometryFloatSource;
  /** Packed UV values with the same vertex count as positions. */
  readonly uvs: StudioVrmTextureGeometryFloatSource;
  /** null/undefined means non-indexed sequential triangles. */
  readonly indices?: StudioVrmTextureGeometryIndexSource | null;
  readonly uvAttribute?: string;
  readonly positionEpsilon?: number;
  readonly uvEpsilon?: number;
  /** May lower, never raise, the product hard limit. */
  readonly maxTriangles?: number;
}

interface WorkerMessageEventLike {
  readonly data: unknown;
}

interface WorkerErrorEventLike {
  preventDefault?(): void;
}

export interface StudioVrmTextureGeometryWorkerLike {
  postMessage(message: StudioVrmTextureGeometryWorkerRequest, transfer: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEventLike) => void,
  ): void;
  terminate(): void;
}

export type StudioVrmTextureGeometryWorkerFactory =
  () => StudioVrmTextureGeometryWorkerLike | null;

export interface StudioVrmTextureGeometryWorkerBuildOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Selected once before topology work starts. Omission selects the product Worker. */
  readonly executionBackend?: StudioVrmTextureGeometryExecutionBackend;
  readonly workerFactory?: StudioVrmTextureGeometryWorkerFactory | null;
}

export interface StudioVrmTextureGeometryWorkerBuildResult {
  readonly execution: StudioVrmTextureGeometryExecutionBackend;
  readonly selectedExecutionBackend: StudioVrmTextureGeometryExecutionBackend;
  readonly attemptedExecutionBackends:
    readonly [StudioVrmTextureGeometryExecutionBackend];
  readonly topology: StudioVrmTextureGeometryWorkerTopology;
}

export type StudioVrmTextureGeometryWorkerClientErrorCode =
  | StudioVrmTextureGeometryWorkerFailureCode
  | "aborted"
  | "direct-failed"
  | "direct-input-too-large"
  | "invalid-input"
  | "protocol"
  | "timeout"
  | "worker-failed"
  | "worker-unavailable";

export class StudioVrmTextureGeometryWorkerClientError extends Error {
  constructor(
    readonly code: StudioVrmTextureGeometryWorkerClientErrorCode,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = code === "aborted"
      ? "AbortError"
      : code === "timeout"
        ? "TimeoutError"
        : "StudioVrmTextureGeometryWorkerClientError";
  }
}

let nextRequestId = 1;
let nextGenerationId = 1;

function nextPositiveId(kind: "request" | "generation"): number {
  if (kind === "request") {
    const value = nextRequestId;
    nextRequestId = value >= Number.MAX_SAFE_INTEGER ? 1 : value + 1;
    return value;
  }
  const value = nextGenerationId;
  nextGenerationId = value >= Number.MAX_SAFE_INTEGER ? 1 : value + 1;
  return value;
}

function clientError(
  code: StudioVrmTextureGeometryWorkerClientErrorCode,
  cause?: unknown,
): StudioVrmTextureGeometryWorkerClientError {
  return new StudioVrmTextureGeometryWorkerClientError(
    code,
    cause === undefined ? undefined : { cause },
  );
}

function defaultWorkerFactory(): StudioVrmTextureGeometryWorkerLike | null {
  if (typeof Worker !== "function") return null;
  return new Worker(new URL("./studio-vrm-texture-geometry.worker.ts", import.meta.url), {
    type: "module",
    name: "toonspectrum-vrm-texture-geometry",
  });
}

function safeCall(callback: () => void): void {
  try {
    callback();
  } catch {
    // Cleanup must not replace the terminal job result.
  }
}

function validEpsilon(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MIN_EPSILON &&
    value <= STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_EPSILON;
}

function normalizedTimeout(value: number | undefined): number {
  if (value === undefined) return STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TIMEOUT_MS
  ) throw clientError("invalid-input");
  return value;
}

function normalizedMaxTriangles(value: number | undefined): number {
  if (value === undefined) return STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TRIANGLES;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TRIANGLES
  ) throw clientError("invalid-input");
  return value;
}

function isPackedFloatSource(value: unknown): value is StudioVrmTextureGeometryFloatSource {
  return value instanceof Float32Array || value instanceof Float64Array;
}

function isIndexSource(value: unknown): value is StudioVrmTextureGeometryIndexSource {
  return value instanceof Uint8Array ||
    value instanceof Uint16Array ||
    value instanceof Uint32Array;
}

function ownedFloatSnapshot(
  source: StudioVrmTextureGeometryFloatSource,
): StudioVrmTextureGeometryWorkerFloatArray {
  return source instanceof Float32Array
    ? Float32Array.from(source)
    : Float64Array.from(source);
}

function checkedInputBytes(
  positions: StudioVrmTextureGeometryWorkerFloatArray,
  uvs: StudioVrmTextureGeometryWorkerFloatArray,
  indices: Uint32Array<ArrayBuffer> | null,
): number {
  let total = positions.byteLength + uvs.byteLength;
  if (indices) total += indices.byteLength;
  if (!Number.isSafeInteger(total) || total < 1 || total > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES) {
    throw clientError("input-budget-exceeded");
  }
  return total;
}

export interface StudioVrmTextureGeometryWorkerRequestOptions {
  readonly requestId?: number;
  readonly generationId?: number;
}

/**
 * Synchronously snapshots caller-mutable typed arrays into standalone transferable buffers.
 * The source geometry buffers are never detached.
 */
export function createStudioVrmTextureGeometryWorkerRequest(
  input: StudioVrmTextureGeometryWorkerInput,
  identity: StudioVrmTextureGeometryWorkerRequestOptions = {},
): StudioVrmTextureGeometryWorkerRequest {
  if (
    typeof input !== "object" ||
    input === null ||
    !isPackedFloatSource(input.positions) ||
    !isPackedFloatSource(input.uvs) ||
    input.positions.length < 9 ||
    input.positions.length % 3 !== 0
  ) throw clientError("invalid-input");
  const vertexCount = input.positions.length / 3;
  if (
    vertexCount > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES ||
    input.uvs.length !== vertexCount * 2
  ) throw clientError(
    vertexCount > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES
      ? "vertex-budget-exceeded"
      : "invalid-input",
  );
  const indicesSource = input.indices ?? null;
  if (indicesSource !== null && !isIndexSource(indicesSource)) {
    throw clientError("invalid-input");
  }
  const triangleCount = indicesSource
    ? indicesSource.length / 3
    : vertexCount / 3;
  if (
    !Number.isSafeInteger(triangleCount) ||
    triangleCount < 1 ||
    (indicesSource !== null && indicesSource.length % 3 !== 0)
  ) throw clientError("invalid-input");
  const maxTriangles = normalizedMaxTriangles(input.maxTriangles);
  if (triangleCount > maxTriangles) throw clientError("triangle-budget-exceeded");

  const uvAttribute = input.uvAttribute ?? "uv";
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(uvAttribute)) {
    throw clientError("invalid-input");
  }
  if (input.positionEpsilon !== undefined && !validEpsilon(input.positionEpsilon)) {
    throw clientError("invalid-input");
  }
  const uvEpsilon = input.uvEpsilon ??
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_DEFAULT_UV_EPSILON;
  if (!validEpsilon(uvEpsilon)) throw clientError("invalid-input");

  const requestId = identity.requestId ?? nextPositiveId("request");
  const generationId = identity.generationId ?? nextPositiveId("generation");
  if (
    !Number.isSafeInteger(requestId) ||
    requestId < 1 ||
    !Number.isSafeInteger(generationId) ||
    generationId < 1
  ) throw clientError("invalid-input");

  const positions = ownedFloatSnapshot(input.positions);
  const uvs = ownedFloatSnapshot(input.uvs);
  const indices = indicesSource === null ? null : Uint32Array.from(indicesSource);
  return Object.freeze({
    version: STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION,
    kind: "build-topology",
    requestId,
    generationId,
    uvAttribute,
    positionEpsilon: input.positionEpsilon ?? null,
    uvEpsilon,
    maxTriangles,
    vertexCount,
    triangleCount,
    inputByteLength: checkedInputBytes(positions, uvs, indices),
    positions,
    uvs,
    indices,
  });
}

export function studioVrmTextureGeometrySupportsDirectExecution(
  request: StudioVrmTextureGeometryWorkerRequest,
): boolean {
  return request.triangleCount <= STUDIO_VRM_TEXTURE_GEOMETRY_DIRECT_MAX_TRIANGLES &&
    request.inputByteLength <= STUDIO_VRM_TEXTURE_GEOMETRY_DIRECT_MAX_INPUT_BYTES;
}

function responseIdentity(
  value: unknown,
): { readonly requestId: number; readonly generationId: number } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const requestId = Reflect.get(value, "requestId");
  const generationId = Reflect.get(value, "generationId");
  return Number.isSafeInteger(requestId) &&
      (requestId as number) > 0 &&
      Number.isSafeInteger(generationId) &&
      (generationId as number) > 0
    ? { requestId: requestId as number, generationId: generationId as number }
    : null;
}

function executionResult(
  executionBackend: StudioVrmTextureGeometryExecutionBackend,
  topology: StudioVrmTextureGeometryWorkerTopology,
): StudioVrmTextureGeometryWorkerBuildResult {
  return Object.freeze({
    execution: executionBackend,
    selectedExecutionBackend: executionBackend,
    attemptedExecutionBackends: Object.freeze([
      executionBackend,
    ]) as readonly [StudioVrmTextureGeometryExecutionBackend],
    topology,
  });
}

function buildDirect(
  request: StudioVrmTextureGeometryWorkerRequest,
): StudioVrmTextureGeometryWorkerBuildResult {
  try {
    return executionResult(
      "direct",
      computeStudioVrmTextureGeometryWorkerTopology(request),
    );
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      typeof cause.code === "string"
    ) {
      throw clientError(cause.code as StudioVrmTextureGeometryWorkerFailureCode, cause);
    }
    throw clientError("direct-failed", cause);
  }
}

/**
 * Selects one topology backend before execution. The default Worker is fail-closed: construction,
 * post, protocol, timeout, and runtime failure never replay the request through direct execution.
 * Direct execution is available only by explicit selection and remains bounded.
 */
export function buildStudioVrmTextureGeometryTopologyInWorker(
  input: StudioVrmTextureGeometryWorkerInput,
  options: StudioVrmTextureGeometryWorkerBuildOptions = {},
): Promise<StudioVrmTextureGeometryWorkerBuildResult> {
  const executionBackend = options.executionBackend ?? "worker";
  if (executionBackend !== "worker" && executionBackend !== "direct") {
    return Promise.reject(clientError("invalid-input"));
  }
  let request: StudioVrmTextureGeometryWorkerRequest;
  let timeoutMs: number;
  try {
    request = createStudioVrmTextureGeometryWorkerRequest(input);
    timeoutMs = normalizedTimeout(options.timeoutMs);
  } catch (cause) {
    return Promise.reject(
      cause instanceof StudioVrmTextureGeometryWorkerClientError
        ? cause
        : clientError("invalid-input", cause),
    );
  }
  if (options.signal?.aborted) {
    return Promise.reject(clientError("aborted"));
  }
  if (executionBackend === "direct") {
    if (!studioVrmTextureGeometrySupportsDirectExecution(request)) {
      return Promise.reject(clientError("direct-input-too-large"));
    }
    return Promise.resolve().then(() => buildDirect(request));
  }
  const factory = options.workerFactory === undefined
    ? defaultWorkerFactory
    : options.workerFactory;
  let worker: StudioVrmTextureGeometryWorkerLike | null = null;
  if (factory) {
    try {
      worker = factory();
    } catch {
      worker = null;
    }
  }
  if (!worker) {
    return Promise.reject(clientError("worker-unavailable"));
  }

  return new Promise<StudioVrmTextureGeometryWorkerBuildResult>((resolve, reject) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeout !== null) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", handleAbort);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleWorkerFailure);
      worker.removeEventListener("messageerror", handleWorkerFailure);
      safeCall(() => worker.terminate());
    };
    const finish = (
      result?: StudioVrmTextureGeometryWorkerBuildResult,
      error?: StudioVrmTextureGeometryWorkerClientError,
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else if (result) resolve(result);
      else reject(clientError("worker-failed"));
    };
    const handleAbort = () => finish(undefined, clientError("aborted"));
    const handleWorkerFailure = (event: WorkerErrorEventLike) => {
      safeCall(() => event.preventDefault?.());
      finish(undefined, clientError("worker-failed"));
    };
    const handleMessage = (event: WorkerMessageEventLike) => {
      const identity = responseIdentity(event.data);
      if (!identity) {
        finish(undefined, clientError("protocol"));
        return;
      }
      if (
        identity.requestId !== request.requestId ||
        identity.generationId !== request.generationId
      ) {
        // A well-formed stale identity never owns this job.
        return;
      }
      if (!isStudioVrmTextureGeometryWorkerResponse(event.data)) {
        finish(undefined, clientError("protocol"));
        return;
      }
      if (event.data.kind === "error") {
        finish(undefined, clientError(event.data.code));
        return;
      }
      const topology = event.data.topology;
      if (
        topology.triangleCount !== request.triangleCount ||
        topology.uvAttribute !== request.uvAttribute ||
        !hasValidStudioVrmTextureGeometryWorkerTopologyNumbers(topology)
      ) {
        finish(undefined, clientError("protocol"));
        return;
      }
      finish(executionResult("worker", topology));
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleWorkerFailure);
    worker.addEventListener("messageerror", handleWorkerFailure);
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    timeout = setTimeout(
      () => finish(undefined, clientError("timeout")),
      timeoutMs,
    );
    try {
      worker.postMessage(
        request,
        studioVrmTextureGeometryWorkerRequestTransfers(request),
      );
    } catch (cause) {
      finish(undefined, clientError("worker-failed", cause));
    }
  });
}
