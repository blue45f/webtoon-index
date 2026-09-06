import {
  STUDIO_XATLAS_UV_PROVIDER_LIMITS,
  type StudioXAtlasUvChartOptions,
  type StudioXAtlasUvExecution,
  type StudioXAtlasUvFailure,
  type StudioXAtlasUvMeshCandidate,
  type StudioXAtlasUvNoFallbackReceipt,
  type StudioXAtlasUvOptions,
  type StudioXAtlasUvProviderLimits,
  type StudioXAtlasUvRequest,
  type StudioXAtlasUvResult,
  type StudioXAtlasUvRuntimeAssets,
} from "./studio-xatlas-uv-provider";
import {
  isStudioXAtlasUvWorkerOutboundMessage,
  STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
  studioXAtlasUvRequestHash,
  studioXAtlasUvRequestTransfers,
  studioXAtlasUvResultHash,
  type StudioXAtlasUvWorkerConfigureMessage,
  type StudioXAtlasUvWorkerInboundMessage,
  type StudioXAtlasUvWorkerOutboundMessage,
} from "./studio-xatlas-uv-provider-protocol";

export const STUDIO_XATLAS_UV_WORKER_STARTUP_TIMEOUT_MS = 30_000;
export const STUDIO_XATLAS_UV_WORKER_REQUEST_TIMEOUT_MS = 120_000;
export const STUDIO_XATLAS_UV_WORKER_MAX_PENDING_REQUESTS = 1;

interface WorkerMessageEvent {
  readonly data: unknown;
}

interface WorkerErrorEvent {
  preventDefault?(): void;
}

export interface StudioXAtlasUvWorkerLike {
  postMessage(message: StudioXAtlasUvWorkerInboundMessage, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: WorkerMessageEvent) => void): void;
  addEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEvent) => void,
  ): void;
  removeEventListener(type: "message", listener: (event: WorkerMessageEvent) => void): void;
  removeEventListener(
    type: "error" | "messageerror",
    listener: (event: WorkerErrorEvent) => void,
  ): void;
  terminate(): void;
}

export interface StudioXAtlasUvWorkerClientOptions {
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly runtimeAssets?: StudioXAtlasUvRuntimeAssets;
  readonly limits?: StudioXAtlasUvProviderLimits;
  readonly workerFactory?: () => StudioXAtlasUvWorkerLike;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly maxPendingRequests?: number;
}

export interface StudioXAtlasUvWorkerClientDiagnostics {
  readonly phase: "cold" | "starting" | "ready" | "unavailable" | "disposed";
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly pendingRequestCount: number;
  readonly admittedRequestCount: number;
}

interface PendingRequest {
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly requestHash: `sha256:${string}`;
  readonly meshes: readonly Readonly<{
    readonly id: string;
    readonly sourceVertexCount: number;
  }>[];
  readonly resolve: (result: StudioXAtlasUvResult) => void;
  readonly signal: AbortSignal | undefined;
  readonly abort: () => void;
  readonly onProgress: StudioXAtlasUvExecution["onProgress"];
  readonly timer: ReturnType<typeof setTimeout>;
  progressSequence: number;
}

function defaultWorkerFactory(): StudioXAtlasUvWorkerLike {
  return new Worker(new URL("./studio-xatlas-uv-provider.worker.ts", import.meta.url), {
    type: "module",
    name: "studio-xatlas-uv-provider",
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function localFailure(
  reason: StudioXAtlasUvFailure["reason"],
  detail: string,
): StudioXAtlasUvFailure {
  return Object.freeze({ ok: false, reason, detail });
}

function unavailable(reason: string): StudioXAtlasUvFailure {
  const fallback: StudioXAtlasUvNoFallbackReceipt = Object.freeze({
    kind: "no-fallback",
    workerAvailable: false,
    mainThreadFallback: false,
    originalInputPreserved: true,
    reason,
  });
  return Object.freeze({
    ok: false,
    reason: "worker-unavailable",
    detail: `xatlas dedicated Worker is unavailable: ${reason}`,
    fallback,
  });
}

function boundedTimeout(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return Math.max(250, Math.min(300_000, Math.floor(value)));
}

function boundedPending(value: number | undefined): number {
  if (value === undefined) return STUDIO_XATLAS_UV_WORKER_MAX_PENDING_REQUESTS;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 8) {
    throw new TypeError("maxPendingRequests must be from one to eight");
  }
  return value;
}

const REQUEST_KEYS = ["operation", "requestEpoch", "documentEpoch", "meshes"] as const;
const MESH_KEYS = ["id", "positions", "indices"] as const;
const OPTION_KEYS = [
  "resolution",
  "padding",
  "rotateCharts",
  "texelsPerUnit",
  "useNormals",
  "chart",
] as const;
const CHART_OPTION_KEYS = [
  "fixWinding",
  "maxBoundaryLength",
  "maxChartArea",
  "maxCost",
  "maxIterations",
  "normalDeviationWeight",
  "normalSeamWeight",
  "roundnessWeight",
  "straightnessWeight",
  "textureSeamWeight",
  "useInputMeshUvs",
] as const;
const OPTION_NUMBER_KEYS = ["resolution", "padding", "texelsPerUnit"] as const;
const OPTION_BOOLEAN_KEYS = ["rotateCharts", "useNormals"] as const;
const CHART_NUMBER_KEYS = [
  "maxBoundaryLength",
  "maxChartArea",
  "maxCost",
  "maxIterations",
  "normalDeviationWeight",
  "normalSeamWeight",
  "roundnessWeight",
  "straightnessWeight",
  "textureSeamWeight",
] as const;
const CHART_BOOLEAN_KEYS = ["fixWinding", "useInputMeshUvs"] as const;
const INVALID_SNAPSHOT = Symbol("invalid-xatlas-request-snapshot");

const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "length",
)?.get;
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  Symbol.toStringTag,
)?.get;

type Mutable<T> = {
  -readonly [Key in keyof T]: T[Key];
};

interface OwnedTypedArrayInfo {
  readonly length: number;
  readonly byteLength: number;
  readonly tag: "Float32Array" | "Uint16Array" | "Uint32Array";
}

interface SnapshotMeshSource {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly indicesAreUint16: boolean;
  readonly normals: Float32Array | undefined;
  readonly uv: Float32Array | undefined;
}

function hasExactOwnKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Reflect.ownKeys(value);
  if (keys.length < required.length || keys.length > required.length + optional.length) {
    return false;
  }
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => (
      typeof key === "string"
      && (required.includes(key) || optional.includes(key))
    ));
}

function ownedTypedArrayInfo(value: ArrayBufferView): OwnedTypedArrayInfo | null {
  if (
    TYPED_ARRAY_BUFFER_GETTER === undefined
    || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined
    || TYPED_ARRAY_LENGTH_GETTER === undefined
    || TYPED_ARRAY_TAG_GETTER === undefined
  ) {
    return null;
  }
  try {
    const buffer = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []) as unknown;
    const byteLength = Reflect.apply(
      TYPED_ARRAY_BYTE_LENGTH_GETTER,
      value,
      [],
    ) as unknown;
    const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []) as unknown;
    const tag = Reflect.apply(TYPED_ARRAY_TAG_GETTER, value, []) as unknown;
    if (
      tag !== "Float32Array"
      && tag !== "Uint16Array"
      && tag !== "Uint32Array"
    ) {
      return null;
    }
    const bytesPerElement = tag === "Uint16Array" ? 2 : 4;
    if (
      !(buffer instanceof ArrayBuffer)
      || typeof byteLength !== "number"
      || !Number.isSafeInteger(byteLength)
      || byteLength < 0
      || typeof length !== "number"
      || !Number.isSafeInteger(length)
      || length < 0
      || byteLength !== length * bytesPerElement
    ) {
      return null;
    }
    return { length, byteLength, tag };
  } catch {
    return null;
  }
}

function snapshotChartOptions(
  candidate: unknown,
): StudioXAtlasUvChartOptions | undefined | typeof INVALID_SNAPSHOT {
  if (candidate === undefined) return undefined;
  if (
    !isPlainRecord(candidate)
    || !hasExactOwnKeys(candidate, [], CHART_OPTION_KEYS)
  ) {
    return INVALID_SNAPSHOT;
  }
  const snapshot: Mutable<StudioXAtlasUvChartOptions> = {};
  for (const key of CHART_NUMBER_KEYS) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (typeof value !== "number") return INVALID_SNAPSHOT;
    snapshot[key] = value;
  }
  for (const key of CHART_BOOLEAN_KEYS) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return INVALID_SNAPSHOT;
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}

function snapshotOptions(
  candidate: unknown,
): StudioXAtlasUvOptions | undefined | typeof INVALID_SNAPSHOT {
  if (candidate === undefined) return undefined;
  if (
    !isPlainRecord(candidate)
    || !hasExactOwnKeys(candidate, [], OPTION_KEYS)
  ) {
    return INVALID_SNAPSHOT;
  }
  const chart = snapshotChartOptions(candidate.chart);
  if (chart === INVALID_SNAPSHOT) return INVALID_SNAPSHOT;
  const snapshot: Mutable<StudioXAtlasUvOptions> = {};
  for (const key of OPTION_NUMBER_KEYS) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (typeof value !== "number") return INVALID_SNAPSHOT;
    snapshot[key] = value;
  }
  for (const key of OPTION_BOOLEAN_KEYS) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") return INVALID_SNAPSHOT;
    snapshot[key] = value;
  }
  if (chart !== undefined) snapshot.chart = chart;
  return Object.freeze(snapshot);
}

function hasOnlyOwnDataGraph(root: unknown): boolean {
  const stack: unknown[] = [root];
  const seen = new Set<object>();
  let visited = 0;
  try {
    while (stack.length > 0) {
      const value = stack.pop();
      if (
        value === null
        || value === undefined
        || typeof value === "string"
        || typeof value === "number"
        || typeof value === "boolean"
        || ArrayBuffer.isView(value)
        || value instanceof ArrayBuffer
      ) {
        continue;
      }
      if (
        typeof value !== "object"
        || (!Array.isArray(value) && !isPlainRecord(value))
        || seen.has(value)
      ) {
        return false;
      }
      seen.add(value);
      visited += 1;
      if (visited > 256) return false;
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(value),
      )) {
        if (!("value" in descriptor)) return false;
        if (Array.isArray(value) && key === "length") continue;
        stack.push(descriptor.value);
      }
    }
    return true;
  } catch {
    return false;
  }
}

function snapshotRequest(
  candidate: unknown,
  limits: StudioXAtlasUvProviderLimits | undefined,
): StudioXAtlasUvRequest | null {
  try {
    if (
      !isPlainRecord(candidate)
      || !hasOnlyOwnDataGraph(candidate)
      || !hasExactOwnKeys(candidate, REQUEST_KEYS, ["options"])
      || candidate.operation !== "unwrap-atlas"
      || !Number.isSafeInteger(candidate.requestEpoch)
      || (candidate.requestEpoch as number) < 0
      || !Number.isSafeInteger(candidate.documentEpoch)
      || (candidate.documentEpoch as number) < 0
      || !Array.isArray(candidate.meshes)
      || candidate.meshes.length === 0
      || candidate.meshes.length
        > (limits?.maxMeshes ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxMeshes)
    ) {
      return null;
    }
    const options = snapshotOptions(candidate.options);
    if (options === INVALID_SNAPSHOT) return null;
    let totalBytes = 0;
    let totalVertices = 0;
    let totalTriangles = 0;
    const sources: SnapshotMeshSource[] = [];
    const seenIds = new Set<string>();
    const maxVerticesPerMesh =
      limits?.maxVerticesPerMesh
      ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxVerticesPerMesh;
    const maxIdentifierCodeUnits =
      limits?.maxIdentifierCodeUnits
      ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxIdentifierCodeUnits;
    const maxVertices =
      limits?.maxVertices ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxVertices;
    const maxTriangles =
      limits?.maxTriangles ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxTriangles;
    const maxInputBytes =
      limits?.maxInputBytes ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxInputBytes;
    for (const mesh of candidate.meshes) {
      if (
        !isPlainRecord(mesh)
        || !hasExactOwnKeys(mesh, MESH_KEYS, ["normals", "uv"])
        || typeof mesh.id !== "string"
        || mesh.id.length === 0
        || mesh.id.length > maxIdentifierCodeUnits
        || mesh.id.trim() !== mesh.id
        || seenIds.has(mesh.id)
        || !(mesh.positions instanceof Float32Array)
        || (
          !(mesh.indices instanceof Uint16Array)
          && !(mesh.indices instanceof Uint32Array)
        )
        || (mesh.normals !== undefined && !(mesh.normals instanceof Float32Array))
        || (mesh.uv !== undefined && !(mesh.uv instanceof Float32Array))
      ) {
        return null;
      }
      const positions = mesh.positions;
      const indices = mesh.indices;
      const normals = mesh.normals as Float32Array | undefined;
      const uv = mesh.uv as Float32Array | undefined;
      const positionsInfo = ownedTypedArrayInfo(positions);
      const indicesInfo = ownedTypedArrayInfo(indices);
      const normalsInfo = normals === undefined ? undefined : ownedTypedArrayInfo(normals);
      const uvInfo = uv === undefined ? undefined : ownedTypedArrayInfo(uv);
      if (
        positionsInfo === null
        || positionsInfo.tag !== "Float32Array"
        || positionsInfo.length === 0
        || positionsInfo.length % 3 !== 0
        || indicesInfo === null
        || (
          indicesInfo.tag !== "Uint16Array"
          && indicesInfo.tag !== "Uint32Array"
        )
        || indicesInfo.length === 0
        || indicesInfo.length % 3 !== 0
        || normalsInfo === null
        || uvInfo === null
        || (normalsInfo !== undefined && normalsInfo.tag !== "Float32Array")
        || (uvInfo !== undefined && uvInfo.tag !== "Float32Array")
        || (
          normalsInfo !== undefined
          && normalsInfo.length !== positionsInfo.length
        )
        || (
          uvInfo !== undefined
          && uvInfo.length !== (positionsInfo.length / 3) * 2
        )
      ) {
        return null;
      }
      const vertices = positionsInfo.length / 3;
      const triangles = indicesInfo.length / 3;
      const meshBytes = positionsInfo.byteLength
        + indicesInfo.byteLength
        + (normalsInfo?.byteLength ?? 0)
        + (uvInfo?.byteLength ?? 0);
      totalVertices += vertices;
      totalTriangles += triangles;
      totalBytes += meshBytes;
      if (
        vertices > maxVerticesPerMesh
        || !Number.isSafeInteger(meshBytes)
        || !Number.isSafeInteger(totalVertices)
        || totalVertices > maxVertices
        || !Number.isSafeInteger(totalTriangles)
        || totalTriangles > maxTriangles
        || !Number.isSafeInteger(totalBytes)
        || totalBytes > maxInputBytes
      ) {
        return null;
      }
      for (let index = 0; index < positionsInfo.length; index += 1) {
        if (!Number.isFinite(positions[index])) return null;
      }
      for (let index = 0; index < indicesInfo.length; index += 1) {
        if ((indices[index] as number) >= vertices) return null;
      }
      if (normals !== undefined && normalsInfo !== undefined) {
        for (let index = 0; index < normalsInfo.length; index += 1) {
          if (!Number.isFinite(normals[index])) return null;
        }
      }
      if (uv !== undefined && uvInfo !== undefined) {
        for (let index = 0; index < uvInfo.length; index += 1) {
          if (!Number.isFinite(uv[index])) return null;
        }
      }
      seenIds.add(mesh.id);
      sources.push({
        id: mesh.id,
        positions,
        indices,
        indicesAreUint16: indicesInfo.tag === "Uint16Array",
        normals,
        uv,
      });
    }
    const meshes = Object.freeze(sources.map((mesh): StudioXAtlasUvMeshCandidate => (
      Object.freeze({
        id: mesh.id,
        positions: new Float32Array(mesh.positions),
        indices: mesh.indicesAreUint16
          ? new Uint16Array(mesh.indices)
          : new Uint32Array(mesh.indices),
        ...(mesh.normals === undefined
          ? {}
          : { normals: new Float32Array(mesh.normals) }),
        ...(mesh.uv === undefined ? {} : { uv: new Float32Array(mesh.uv) }),
      })
    )));
    return Object.freeze({
      operation: "unwrap-atlas",
      requestEpoch: candidate.requestEpoch as number,
      documentEpoch: candidate.documentEpoch as number,
      meshes,
      ...(options === undefined ? {} : { options }),
    });
  } catch {
    return null;
  }
}

function boundSuccessMatches(
  message: Extract<
    StudioXAtlasUvWorkerOutboundMessage,
    { readonly type: "studio-xatlas-uv/result" }
  >,
  pending: PendingRequest,
  limits: StudioXAtlasUvProviderLimits | undefined,
): boolean {
  if (!message.result.ok || message.binding === undefined) return false;
  const { artifact } = message.result;
  if (
    message.binding.requestEpoch !== pending.requestEpoch
    || message.binding.documentEpoch !== pending.documentEpoch
    || message.binding.requestHash !== pending.requestHash
    || message.binding.resultHash !== studioXAtlasUvResultHash(message.result)
    || artifact.positions.length === 0
    || artifact.positions.length % 3 !== 0
    || artifact.uv.length !== (artifact.positions.length / 3) * 2
    || artifact.indices.length === 0
    || artifact.indices.length % 3 !== 0
    || artifact.meshes.length !== pending.meshes.length
  ) {
    return false;
  }
  const vertexCount = artifact.positions.length / 3;
  const triangleCount = artifact.indices.length / 3;
  const outputBytes =
    artifact.positions.byteLength
    + artifact.uv.byteLength
    + artifact.indices.byteLength;
  if (
    vertexCount
      > (limits?.maxOutputVertices
        ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxOutputVertices)
    || triangleCount
      > (limits?.maxOutputTriangles
        ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxOutputTriangles)
    || outputBytes
      > (limits?.maxOutputBytes ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxOutputBytes)
    || artifact.atlas.width
      > (limits?.maxAtlasResolution
        ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxAtlasResolution)
    || artifact.atlas.height
      > (limits?.maxAtlasResolution
        ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxAtlasResolution)
    || artifact.atlas.count
      > (limits?.maxAtlasCount ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxAtlasCount)
  ) {
    return false;
  }
  for (const index of artifact.indices) {
    if (index >= vertexCount) return false;
  }
  let expectedVertexOffset = 0;
  let expectedIndexOffset = 0;
  for (let index = 0; index < pending.meshes.length; index += 1) {
    const expected = pending.meshes[index];
    const range = artifact.meshes[index];
    if (
      range === undefined
      || expected === undefined
      || range.id !== expected.id
      || range.sourceVertexCount !== expected.sourceVertexCount
      || range.vertexOffset !== expectedVertexOffset
      || range.indexOffset !== expectedIndexOffset
      || range.vertexCount
        > (limits?.maxVerticesPerMesh
          ?? STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxVerticesPerMesh)
      || range.vertexOffset + range.vertexCount > vertexCount
      || range.indexOffset + range.indexCount > artifact.indices.length
      || range.indexCount % 3 !== 0
      || range.atlasSegments.some((segment) => (
        segment.indexOffset < range.indexOffset
        || segment.indexOffset + segment.indexCount
          > range.indexOffset + range.indexCount
        || segment.atlasIndex >= artifact.atlas.count
      ))
    ) {
      return false;
    }
    expectedVertexOffset += range.vertexCount;
    expectedIndexOffset += range.indexCount;
  }
  return (
    expectedVertexOffset === vertexCount
    && expectedIndexOffset === artifact.indices.length
  );
}

export class StudioXAtlasUvWorkerClient {
  private readonly workerFactory: () => StudioXAtlasUvWorkerLike;
  private readonly startupTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxPendingRequests: number;
  private readonly configureMessage: StudioXAtlasUvWorkerConfigureMessage;
  private readonly limits: StudioXAtlasUvProviderLimits | undefined;
  private worker: StudioXAtlasUvWorkerLike | null = null;
  private phase: StudioXAtlasUvWorkerClientDiagnostics["phase"] = "cold";
  private requestEpoch: number;
  private documentEpoch: number;
  private nextRequestId = 1;
  private admittedRequestCount = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readyPromise: Promise<boolean> | null = null;
  private resolveReady: ((ready: boolean) => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private unavailableResult: StudioXAtlasUvFailure | null = null;

  constructor(options: StudioXAtlasUvWorkerClientOptions) {
    if (
      !isPlainRecord(options)
      || !Object.keys(options).every((key) => (
        key === "requestEpoch"
        || key === "documentEpoch"
        || key === "runtimeAssets"
        || key === "limits"
        || key === "workerFactory"
        || key === "startupTimeoutMs"
        || key === "requestTimeoutMs"
        || key === "maxPendingRequests"
      ))
      || !Object.hasOwn(options, "requestEpoch")
      || !Object.hasOwn(options, "documentEpoch")
      || !Number.isSafeInteger(options.requestEpoch)
      || options.requestEpoch < 0
      || !Number.isSafeInteger(options.documentEpoch)
      || options.documentEpoch < 0
      || (options.workerFactory !== undefined && typeof options.workerFactory !== "function")
    ) {
      throw new TypeError("xatlas Worker client options are invalid");
    }
    const validated = options as StudioXAtlasUvWorkerClientOptions;
    this.requestEpoch = validated.requestEpoch;
    this.documentEpoch = validated.documentEpoch;
    this.workerFactory = validated.workerFactory ?? defaultWorkerFactory;
    this.startupTimeoutMs = boundedTimeout(
      validated.startupTimeoutMs,
      STUDIO_XATLAS_UV_WORKER_STARTUP_TIMEOUT_MS,
      "startupTimeoutMs",
    );
    this.requestTimeoutMs = boundedTimeout(
      validated.requestTimeoutMs ?? validated.limits?.maxExecutionMs,
      STUDIO_XATLAS_UV_WORKER_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    );
    this.maxPendingRequests = boundedPending(validated.maxPendingRequests);
    this.limits = validated.limits;
    this.configureMessage = {
      type: "studio-xatlas-uv/configure",
      version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
      requestEpoch: this.requestEpoch,
      documentEpoch: this.documentEpoch,
      ...(validated.runtimeAssets === undefined
        ? {}
        : { runtimeAssets: structuredClone(validated.runtimeAssets) }),
      ...(validated.limits === undefined
        ? {}
        : { limits: structuredClone(validated.limits) }),
    };
  }

  private clearStartupTimer(): void {
    if (this.startupTimer !== null) clearTimeout(this.startupTimer);
    this.startupTimer = null;
  }

  private detachWorker(): void {
    if (this.worker === null) return;
    try {
      this.worker.removeEventListener("message", this.onMessage);
      this.worker.removeEventListener("error", this.onWorkerError);
      this.worker.removeEventListener("messageerror", this.onWorkerError);
      this.worker.terminate();
    } catch {
      // Deterministic local settlement does not depend on a host shim.
    }
    this.worker = null;
  }

  private settle(requestId: string, result: StudioXAtlasUvResult): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    this.pending.delete(requestId);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.abort);
    pending.resolve(result);
  }

  private failUnavailable(reason: string): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    this.unavailableResult = unavailable(reason);
    this.phase = "unavailable";
    this.detachWorker();
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.readyPromise = null;
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, this.unavailableResult);
    }
  }

  private restartCold(
    primaryRequestId: string | null,
    primaryResult: StudioXAtlasUvResult,
  ): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    this.detachWorker();
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.readyPromise = null;
    this.phase = "cold";
    if (primaryRequestId !== null) this.settle(primaryRequestId, primaryResult);
    const collateral = unavailable("worker-restarted");
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, collateral);
    }
  }

  private readonly onMessage = (event: WorkerMessageEvent): void => {
    if (
      this.phase === "disposed"
      || !isStudioXAtlasUvWorkerOutboundMessage(event.data)
    ) {
      if (this.phase !== "disposed") this.failUnavailable("protocol-error");
      return;
    }
    const message = event.data;
    if (message.type === "studio-xatlas-uv/ready") {
      if (this.phase !== "starting" || this.worker === null) {
        this.failUnavailable("protocol-error");
        return;
      }
      if (
        this.requestEpoch !== this.configureMessage.requestEpoch
        || this.documentEpoch !== this.configureMessage.documentEpoch
      ) {
        try {
          this.worker.postMessage({
            type: "studio-xatlas-uv/advance-epochs",
            version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
            requestEpoch: this.requestEpoch,
            documentEpoch: this.documentEpoch,
          });
        } catch {
          this.failUnavailable("worker-error");
          return;
        }
      }
      this.clearStartupTimer();
      this.phase = "ready";
      this.resolveReady?.(true);
      this.resolveReady = null;
      return;
    }
    if (message.type === "studio-xatlas-uv/startup-failure") {
      this.failUnavailable("startup-failure");
      return;
    }
    if (this.phase !== "ready") {
      this.failUnavailable("protocol-error");
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (pending === undefined) {
      this.failUnavailable("protocol-error");
      return;
    }
    if (message.type === "studio-xatlas-uv/progress") {
      if (message.sequence <= pending.progressSequence) {
        this.failUnavailable("protocol-error");
        return;
      }
      pending.progressSequence = message.sequence;
      try {
        pending.onProgress?.(Object.freeze({
          sequence: message.sequence,
          mode: message.mode,
          progress: message.progress,
        }));
      } catch {
        this.restartCold(
          message.requestId,
          localFailure("provider-failure", "xatlas progress consumer failed"),
        );
      }
      return;
    }
    if (
      message.result.ok
      && (
        pending.requestEpoch !== this.requestEpoch
        || pending.documentEpoch !== this.documentEpoch
        || !boundSuccessMatches(message, pending, this.limits)
      )
    ) {
      this.restartCold(
        message.requestId,
        localFailure(
          "invalid-provider-output",
          "xatlas Worker result does not match its admitted request",
        ),
      );
      return;
    }
    this.settle(message.requestId, message.result);
  };

  private readonly onWorkerError = (event: WorkerErrorEvent): void => {
    event.preventDefault?.();
    this.failUnavailable("worker-error");
  };

  private ensureReady(): Promise<boolean> {
    if (this.phase === "ready") return Promise.resolve(true);
    if (this.phase === "unavailable" || this.phase === "disposed") {
      return Promise.resolve(false);
    }
    if (this.readyPromise !== null) return this.readyPromise;
    this.phase = "starting";
    this.readyPromise = new Promise<boolean>((resolve) => {
      this.resolveReady = resolve;
    });
    try {
      this.worker = this.workerFactory();
      this.worker.addEventListener("message", this.onMessage);
      this.worker.addEventListener("error", this.onWorkerError);
      this.worker.addEventListener("messageerror", this.onWorkerError);
      this.worker.postMessage({
        ...this.configureMessage,
        requestEpoch: this.requestEpoch,
        documentEpoch: this.documentEpoch,
      });
    } catch {
      this.failUnavailable("construction-failed");
      return this.readyPromise ?? Promise.resolve(false);
    }
    this.startupTimer = setTimeout(
      () => this.failUnavailable("startup-timeout"),
      this.startupTimeoutMs,
    );
    return this.readyPromise;
  }

  public async execute(
    candidate: unknown,
    execution: StudioXAtlasUvExecution = {},
  ): Promise<StudioXAtlasUvResult> {
    if (this.phase === "disposed") {
      return localFailure("disposed", "xatlas Worker client is disposed");
    }
    if (
      !isPlainRecord(execution)
      || !Object.keys(execution).every((key) => key === "signal" || key === "onProgress")
      || !Object.values(Object.getOwnPropertyDescriptors(execution))
        .every((descriptor) => "value" in descriptor)
    ) {
      return localFailure("invalid-input", "xatlas Worker execution options are invalid");
    }
    const signal = Object.getOwnPropertyDescriptor(execution, "signal")?.value;
    const onProgress = Object.getOwnPropertyDescriptor(execution, "onProgress")?.value;
    if (
      (signal !== undefined && !(signal instanceof AbortSignal))
      || (onProgress !== undefined && typeof onProgress !== "function")
    ) {
      return localFailure("invalid-input", "xatlas Worker execution options are invalid");
    }
    const validatedExecution: StudioXAtlasUvExecution = Object.freeze({
      ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
      ...(onProgress === undefined
        ? {}
        : { onProgress: onProgress as NonNullable<StudioXAtlasUvExecution["onProgress"]> }),
    });
    if (validatedExecution.signal?.aborted) {
      return localFailure("cancelled", "xatlas Worker request was cancelled");
    }
    if (this.admittedRequestCount >= this.maxPendingRequests) {
      return localFailure(
        "backpressure",
        "xatlas Worker pending-request budget exceeded",
      );
    }
    const request = snapshotRequest(candidate, this.limits);
    if (request === null) {
      return localFailure("invalid-input", "xatlas Worker request could not be cloned");
    }
    if (request.requestEpoch !== this.requestEpoch) {
      return localFailure("stale-request-epoch", "xatlas Worker request epoch is stale");
    }
    if (request.documentEpoch !== this.documentEpoch) {
      return localFailure("stale-document-epoch", "xatlas Worker document epoch is stale");
    }

    this.admittedRequestCount += 1;
    try {
      let abortedDuringStartup = false;
      const startupAbort = (): void => {
        abortedDuringStartup = true;
        this.restartCold(
          null,
          localFailure("cancelled", "xatlas Worker request was cancelled"),
        );
      };
      validatedExecution.signal?.addEventListener("abort", startupAbort, { once: true });
      const ready = await this.ensureReady();
      validatedExecution.signal?.removeEventListener("abort", startupAbort);
      if (abortedDuringStartup || validatedExecution.signal?.aborted) {
        return localFailure("cancelled", "xatlas Worker request was cancelled");
      }
      if (!ready || this.worker === null) {
        return this.unavailableResult ?? unavailable("construction-failed");
      }
      if (request.requestEpoch !== this.requestEpoch) {
        return localFailure(
          "stale-request-epoch",
          "xatlas Worker request became stale during startup",
        );
      }
      if (request.documentEpoch !== this.documentEpoch) {
        return localFailure(
          "stale-document-epoch",
          "xatlas Worker document became stale during startup",
        );
      }

      const requestId = `xatlas-${this.nextRequestId}`;
      this.nextRequestId = this.nextRequestId >= Number.MAX_SAFE_INTEGER
        ? 1
        : this.nextRequestId + 1;
      return await new Promise<StudioXAtlasUvResult>((resolve) => {
        const requestHash = studioXAtlasUvRequestHash(request);
        const abort = (): void => {
          if (!this.pending.has(requestId)) return;
          try {
            this.worker?.postMessage({
              type: "studio-xatlas-uv/cancel",
              version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
              requestId,
            });
          } catch {
            // Worker termination below remains authoritative.
          }
          this.restartCold(
            requestId,
            localFailure("cancelled", "xatlas Worker request was cancelled"),
          );
        };
        const timer = setTimeout(() => {
          this.restartCold(
            requestId,
            localFailure(
              "time-budget-exceeded",
              "xatlas Worker was terminated after exceeding its time budget",
            ),
          );
        }, this.requestTimeoutMs);
        this.pending.set(requestId, {
          requestEpoch: request.requestEpoch,
          documentEpoch: request.documentEpoch,
          requestHash,
          meshes: Object.freeze(request.meshes.map((mesh) => Object.freeze({
            id: mesh.id,
            sourceVertexCount: mesh.positions.length / 3,
          }))),
          resolve,
          signal: validatedExecution.signal,
          abort,
          onProgress: validatedExecution.onProgress,
          timer,
          progressSequence: 0,
        });
        validatedExecution.signal?.addEventListener("abort", abort, { once: true });
        try {
          this.worker?.postMessage({
            type: "studio-xatlas-uv/execute",
            version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
            requestId,
            request,
          }, studioXAtlasUvRequestTransfers(request));
        } catch {
          this.failUnavailable("worker-error");
        }
      });
    } finally {
      this.admittedRequestCount -= 1;
    }
  }

  public advanceEpochs(nextRequestEpoch: number, nextDocumentEpoch: number): boolean {
    if (
      this.phase === "disposed"
      || !Number.isSafeInteger(nextRequestEpoch)
      || nextRequestEpoch < this.requestEpoch
      || !Number.isSafeInteger(nextDocumentEpoch)
      || nextDocumentEpoch < this.documentEpoch
      || (
        nextRequestEpoch === this.requestEpoch
        && nextDocumentEpoch === this.documentEpoch
      )
    ) {
      return false;
    }
    this.requestEpoch = nextRequestEpoch;
    this.documentEpoch = nextDocumentEpoch;
    if (this.pending.size > 0) {
      this.clearStartupTimer();
      this.detachWorker();
      this.resolveReady?.(false);
      this.resolveReady = null;
      this.readyPromise = null;
      this.phase = "cold";
      for (const [requestId, pending] of [...this.pending]) {
        const result = pending.documentEpoch < nextDocumentEpoch
          ? localFailure("stale-document-epoch", "xatlas Worker document became stale")
          : localFailure("stale-request-epoch", "xatlas Worker request became stale");
        this.settle(requestId, result);
      }
      return true;
    }
    if (this.worker !== null && this.phase === "ready") {
      try {
        this.worker.postMessage({
          type: "studio-xatlas-uv/advance-epochs",
          version: STUDIO_XATLAS_UV_WORKER_PROTOCOL_VERSION,
          requestEpoch: nextRequestEpoch,
          documentEpoch: nextDocumentEpoch,
        });
      } catch {
        this.failUnavailable("worker-error");
      }
    }
    return true;
  }

  public getDiagnostics(): StudioXAtlasUvWorkerClientDiagnostics {
    return Object.freeze({
      phase: this.phase,
      requestEpoch: this.requestEpoch,
      documentEpoch: this.documentEpoch,
      pendingRequestCount: this.pending.size,
      admittedRequestCount: this.admittedRequestCount,
    });
  }

  public dispose(): void {
    if (this.phase === "disposed") return;
    this.clearStartupTimer();
    this.phase = "disposed";
    this.resolveReady?.(false);
    this.resolveReady = null;
    this.readyPromise = null;
    this.detachWorker();
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, localFailure("disposed", "xatlas Worker client is disposed"));
    }
  }
}

export function createStudioXAtlasUvWorkerClient(
  options: StudioXAtlasUvWorkerClientOptions,
): StudioXAtlasUvWorkerClient {
  return new StudioXAtlasUvWorkerClient(options);
}
