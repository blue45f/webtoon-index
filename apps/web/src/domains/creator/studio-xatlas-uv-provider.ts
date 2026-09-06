/**
 * Renderer-neutral contracts and orchestration for xatlas UV generation.
 *
 * This module accepts and returns only plain metadata plus owned typed arrays.
 * The production adapter is loaded lazily inside a dedicated Worker and owns
 * every xatlasjs/WASM resource.
 */

export const STUDIO_XATLAS_UV_PROVIDER_VERSION = 1 as const;

export const STUDIO_XATLAS_UV_PROVIDER_LIMITS = Object.freeze({
  maxMeshes: 64,
  maxIdentifierCodeUnits: 128,
  maxVerticesPerMesh: 65_535,
  maxVertices: 1_000_000,
  maxTriangles: 2_000_000,
  maxInputBytes: 256 * 1024 * 1024,
  maxOutputVertices: 4_000_000,
  maxOutputTriangles: 2_000_000,
  maxOutputBytes: 512 * 1024 * 1024,
  maxAtlasResolution: 8_192,
  maxAtlasCount: 16,
  maxPadding: 64,
  maxTexelsPerUnit: 1_000_000,
  maxChartIterations: 1_024,
  maxChartScalar: 1_000_000,
  maxProgressEvents: 4_096,
  maxExecutionMs: 120_000,
  maxPendingRequests: 1,
  maxRuntimeUrlCodeUnits: 2_048,
} as const);

export interface StudioXAtlasUvMeshCandidate {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly normals?: Float32Array;
  readonly uv?: Float32Array;
}

export interface StudioXAtlasUvChartOptions {
  readonly fixWinding?: boolean;
  readonly maxBoundaryLength?: number;
  readonly maxChartArea?: number;
  readonly maxCost?: number;
  readonly maxIterations?: number;
  readonly normalDeviationWeight?: number;
  readonly normalSeamWeight?: number;
  readonly roundnessWeight?: number;
  readonly straightnessWeight?: number;
  readonly textureSeamWeight?: number;
  readonly useInputMeshUvs?: boolean;
}

export interface StudioXAtlasUvOptions {
  readonly resolution?: number;
  readonly padding?: number;
  readonly rotateCharts?: boolean;
  readonly texelsPerUnit?: number;
  readonly useNormals?: boolean;
  readonly chart?: StudioXAtlasUvChartOptions;
}

export interface StudioXAtlasUvRequest {
  readonly operation: "unwrap-atlas";
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly meshes: readonly StudioXAtlasUvMeshCandidate[];
  readonly options?: StudioXAtlasUvOptions;
}

export interface StudioXAtlasUvAtlasSegment {
  readonly indexOffset: number;
  readonly indexCount: number;
  readonly atlasIndex: number;
}

export interface StudioXAtlasUvMeshRange {
  readonly id: string;
  readonly sourceVertexCount: number;
  readonly vertexOffset: number;
  readonly vertexCount: number;
  readonly indexOffset: number;
  readonly indexCount: number;
  readonly atlasSegments: readonly StudioXAtlasUvAtlasSegment[];
}

export interface StudioXAtlasUvAtlasReceipt {
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly texelsPerUnit: number;
}

export interface StudioXAtlasUvCapabilityReceipt {
  readonly packageName: "xatlasjs";
  readonly packageVersion: string;
  readonly runtimeSource: "package-dynamic-import" | "injected";
  readonly intendedHost: "dedicated-worker";
  readonly executionTopology: "single-dedicated-worker";
  readonly rendererNeutral: true;
  readonly defensiveInputCopy: true;
  readonly defensiveOutputCopy: true;
  readonly originalInputPreserved: true;
  readonly nativeHandlesReturned: false;
  readonly mainThreadFallback: false;
  readonly atlasCleanup: "direct-destroyAtlas-finally";
  readonly geometryCleanup: "release-typed-array-snapshots";
  readonly wasmCleanup: "dedicated-worker-termination";
}

export interface StudioXAtlasUvArtifact {
  readonly kind: "studio-xatlas-uv-atlas";
  readonly version: typeof STUDIO_XATLAS_UV_PROVIDER_VERSION;
  readonly positions: Float32Array;
  readonly uv: Float32Array;
  readonly indices: Uint32Array;
  readonly meshes: readonly StudioXAtlasUvMeshRange[];
  readonly atlas: StudioXAtlasUvAtlasReceipt;
  readonly receipt: StudioXAtlasUvCapabilityReceipt;
}

export type StudioXAtlasUvFailureReason =
  | "invalid-input"
  | "budget-exceeded"
  | "progress-budget-exceeded"
  | "time-budget-exceeded"
  | "backpressure"
  | "cancelled"
  | "stale-request-epoch"
  | "stale-document-epoch"
  | "provider-unavailable"
  | "provider-failure"
  | "invalid-provider-output"
  | "cleanup-failure"
  | "disposed"
  | "worker-unavailable";

export interface StudioXAtlasUvNoFallbackReceipt {
  readonly kind: "no-fallback";
  readonly workerAvailable: false;
  readonly mainThreadFallback: false;
  readonly originalInputPreserved: true;
  readonly reason: string;
}

export interface StudioXAtlasUvFailure {
  readonly ok: false;
  readonly reason: StudioXAtlasUvFailureReason;
  readonly detail: string;
  readonly fallback?: StudioXAtlasUvNoFallbackReceipt;
}

export interface StudioXAtlasUvSuccess {
  readonly ok: true;
  readonly artifact: StudioXAtlasUvArtifact;
}

export type StudioXAtlasUvResult = StudioXAtlasUvSuccess | StudioXAtlasUvFailure;

export interface StudioXAtlasUvProgress {
  readonly sequence: number;
  readonly mode: string;
  readonly progress: number;
}

export interface StudioXAtlasUvExecution {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: StudioXAtlasUvProgress) => void;
}

export interface StudioXAtlasUvRuntimeAssets {
  readonly wasmUrl: string;
  readonly moduleUrl: string;
}

export interface StudioXAtlasUvProviderLimits {
  readonly maxMeshes?: number;
  readonly maxIdentifierCodeUnits?: number;
  readonly maxVerticesPerMesh?: number;
  readonly maxVertices?: number;
  readonly maxTriangles?: number;
  readonly maxInputBytes?: number;
  readonly maxOutputVertices?: number;
  readonly maxOutputTriangles?: number;
  readonly maxOutputBytes?: number;
  readonly maxAtlasResolution?: number;
  readonly maxAtlasCount?: number;
  readonly maxPadding?: number;
  readonly maxTexelsPerUnit?: number;
  readonly maxChartIterations?: number;
  readonly maxChartScalar?: number;
  readonly maxProgressEvents?: number;
  readonly maxExecutionMs?: number;
  readonly maxPendingRequests?: number;
  readonly maxRuntimeUrlCodeUnits?: number;
}

export interface StudioXAtlasUvProviderDiagnostics {
  readonly phase: "cold" | "ready" | "disposed";
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly pendingRequestCount: number;
  readonly completedRequestCount: number;
  readonly rejectedRequestCount: number;
  readonly createdGeometryCount: number;
  readonly releasedGeometryCount: number;
  readonly atlasCleanupAttemptCount: number;
  readonly atlasCleanupFailureCount: number;
  readonly progressEventCount: number;
}

export interface StudioXAtlasUvRuntimeMeshInput {
  readonly id: string;
  readonly positions: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
  readonly normals: Float32Array | null;
  readonly uv: Float32Array | null;
}

export interface StudioXAtlasUvRuntimePackOptions {
  readonly pack: Readonly<{
    readonly resolution: number;
    readonly padding: number;
    readonly rotateCharts: boolean;
    readonly texelsPerUnit: number | null;
    readonly createImage: false;
    readonly bruteForce: false;
  }>;
  readonly chart: Readonly<{
    readonly fixWinding?: boolean;
    readonly maxBoundaryLength?: number;
    readonly maxChartArea?: number;
    readonly maxCost?: number;
    readonly maxIterations?: number;
    readonly normalDeviationWeight?: number;
    readonly normalSeamWeight?: number;
    readonly roundnessWeight?: number;
    readonly straightnessWeight?: number;
    readonly textureSeamWeight?: number;
    readonly useInputMeshUvs?: boolean;
  }>;
  readonly useNormals: boolean;
}

export interface StudioXAtlasUvRuntimeGeometry {
  readonly id: string;
  release(): void;
}

export interface StudioXAtlasUvRuntimeMeshOutput {
  readonly id: string;
  readonly positions: ArrayLike<number>;
  readonly uv: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly atlasSegments?: readonly Readonly<{
    readonly index: number;
    readonly count: number;
    readonly atlasIndex: number;
  }>[];
}

export interface StudioXAtlasUvRuntimeAtlas {
  readonly width: number;
  readonly height: number;
  readonly atlasCount: number;
  readonly meshCount: number;
  readonly texelsPerUnit: number;
  readonly meshes: readonly StudioXAtlasUvRuntimeMeshOutput[];
}

export interface StudioXAtlasUvRuntime {
  readonly packageVersion: string;
  initialize(
    assets: StudioXAtlasUvRuntimeAssets | null,
    onProgress: (mode: unknown, progress: unknown) => void,
  ): Promise<void>;
  createGeometry(mesh: StudioXAtlasUvRuntimeMeshInput): StudioXAtlasUvRuntimeGeometry;
  pack(
    geometries: readonly StudioXAtlasUvRuntimeGeometry[],
    options: StudioXAtlasUvRuntimePackOptions,
    onProgress: (mode: unknown, progress: unknown) => void,
  ): Promise<StudioXAtlasUvRuntimeAtlas>;
  cleanupAtlas(): Promise<boolean>;
  dispose(): void | Promise<void>;
}

export interface StudioXAtlasUvProviderOptions {
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly runtimeAssets?: StudioXAtlasUvRuntimeAssets;
  readonly limits?: StudioXAtlasUvProviderLimits;
  readonly runtimeLoader?: () => StudioXAtlasUvRuntime | PromiseLike<StudioXAtlasUvRuntime>;
  readonly now?: () => number;
  /**
   * Worker-host-only ownership handoff. The caller must own every transferred
   * typed array; direct consumers keep the default defensive copy.
   */
  readonly inputOwnership?: "copy" | "transferred";
}

interface ResolvedLimits {
  readonly maxMeshes: number;
  readonly maxIdentifierCodeUnits: number;
  readonly maxVerticesPerMesh: number;
  readonly maxVertices: number;
  readonly maxTriangles: number;
  readonly maxInputBytes: number;
  readonly maxOutputVertices: number;
  readonly maxOutputTriangles: number;
  readonly maxOutputBytes: number;
  readonly maxAtlasResolution: number;
  readonly maxAtlasCount: number;
  readonly maxPadding: number;
  readonly maxTexelsPerUnit: number;
  readonly maxChartIterations: number;
  readonly maxChartScalar: number;
  readonly maxProgressEvents: number;
  readonly maxExecutionMs: number;
  readonly maxPendingRequests: number;
  readonly maxRuntimeUrlCodeUnits: number;
}

interface ParsedMesh extends StudioXAtlasUvRuntimeMeshInput {
  readonly sourceVertexCount: number;
  readonly sourceTriangleCount: number;
}

interface ParsedRequest {
  readonly operation: "unwrap-atlas";
  readonly requestEpoch: number;
  readonly documentEpoch: number;
  readonly meshes: readonly ParsedMesh[];
  readonly options: StudioXAtlasUvRuntimePackOptions;
}

const LIMIT_KEYS = [
  "maxMeshes",
  "maxIdentifierCodeUnits",
  "maxVerticesPerMesh",
  "maxVertices",
  "maxTriangles",
  "maxInputBytes",
  "maxOutputVertices",
  "maxOutputTriangles",
  "maxOutputBytes",
  "maxAtlasResolution",
  "maxAtlasCount",
  "maxPadding",
  "maxTexelsPerUnit",
  "maxChartIterations",
  "maxChartScalar",
  "maxProgressEvents",
  "maxExecutionMs",
  "maxPendingRequests",
  "maxRuntimeUrlCodeUnits",
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

class StudioXAtlasUvStop extends Error {
  constructor(
    readonly reason: StudioXAtlasUvFailureReason,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "StudioXAtlasUvStop";
  }
}

function stop(reason: StudioXAtlasUvFailureReason, detail: string): never {
  throw new StudioXAtlasUvStop(reason, detail);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  if (keys.length < required.length || keys.length > required.length + optional.length) {
    return false;
  }
  return required.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => required.includes(key) || optional.includes(key));
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function nonNegativeInteger(value: unknown, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    stop("invalid-input", `${name} must be a bounded non-negative safe integer`);
  }
  return value as number;
}

function boundedPositiveFinite(
  value: unknown,
  name: string,
  maximum: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > maximum) {
    stop("invalid-input", `${name} must be a bounded positive finite number`);
  }
  return value;
}

function checkedAdd(left: number, right: number, reason: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) stop("budget-exceeded", `${reason} overflowed`);
  return result;
}

function resolveLimits(candidate: StudioXAtlasUvProviderLimits | undefined): ResolvedLimits {
  if (
    candidate !== undefined
    && (!isPlainRecord(candidate) || !hasExactKeys(candidate, [], LIMIT_KEYS))
  ) {
    throw new TypeError("xatlas provider limits contain unknown fields");
  }
  const limits = (candidate ?? {}) as StudioXAtlasUvProviderLimits;
  const resolved = {
    maxMeshes: positiveInteger(
      limits.maxMeshes,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxMeshes,
      "maxMeshes",
    ),
    maxIdentifierCodeUnits: positiveInteger(
      limits.maxIdentifierCodeUnits,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxIdentifierCodeUnits,
      "maxIdentifierCodeUnits",
    ),
    maxVerticesPerMesh: positiveInteger(
      limits.maxVerticesPerMesh,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxVerticesPerMesh,
      "maxVerticesPerMesh",
    ),
    maxVertices: positiveInteger(
      limits.maxVertices,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxVertices,
      "maxVertices",
    ),
    maxTriangles: positiveInteger(
      limits.maxTriangles,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxTriangles,
      "maxTriangles",
    ),
    maxInputBytes: positiveInteger(
      limits.maxInputBytes,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxInputBytes,
      "maxInputBytes",
    ),
    maxOutputVertices: positiveInteger(
      limits.maxOutputVertices,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxOutputVertices,
      "maxOutputVertices",
    ),
    maxOutputTriangles: positiveInteger(
      limits.maxOutputTriangles,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxOutputTriangles,
      "maxOutputTriangles",
    ),
    maxOutputBytes: positiveInteger(
      limits.maxOutputBytes,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxOutputBytes,
      "maxOutputBytes",
    ),
    maxAtlasResolution: positiveInteger(
      limits.maxAtlasResolution,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxAtlasResolution,
      "maxAtlasResolution",
    ),
    maxAtlasCount: positiveInteger(
      limits.maxAtlasCount,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxAtlasCount,
      "maxAtlasCount",
    ),
    maxPadding: positiveInteger(
      limits.maxPadding,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxPadding,
      "maxPadding",
    ),
    maxTexelsPerUnit: positiveInteger(
      limits.maxTexelsPerUnit,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxTexelsPerUnit,
      "maxTexelsPerUnit",
    ),
    maxChartIterations: positiveInteger(
      limits.maxChartIterations,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxChartIterations,
      "maxChartIterations",
    ),
    maxChartScalar: positiveInteger(
      limits.maxChartScalar,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxChartScalar,
      "maxChartScalar",
    ),
    maxProgressEvents: positiveInteger(
      limits.maxProgressEvents,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxProgressEvents,
      "maxProgressEvents",
    ),
    maxExecutionMs: positiveInteger(
      limits.maxExecutionMs,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxExecutionMs,
      "maxExecutionMs",
    ),
    maxPendingRequests: positiveInteger(
      limits.maxPendingRequests,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxPendingRequests,
      "maxPendingRequests",
    ),
    maxRuntimeUrlCodeUnits: positiveInteger(
      limits.maxRuntimeUrlCodeUnits,
      STUDIO_XATLAS_UV_PROVIDER_LIMITS.maxRuntimeUrlCodeUnits,
      "maxRuntimeUrlCodeUnits",
    ),
  } satisfies ResolvedLimits;
  if (resolved.maxVerticesPerMesh > 65_535) {
    throw new TypeError(
      "maxVerticesPerMesh cannot exceed xatlasjs's safe Uint16 boundary",
    );
  }
  return Object.freeze(resolved);
}

function parseRuntimeUrl(value: unknown, name: string, limits: ResolvedLimits): string {
  if (typeof value !== "string" || value.length === 0 || value.length > limits.maxRuntimeUrlCodeUnits) {
    throw new TypeError(`${name} must be a bounded URL`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${name} must be an absolute URL`);
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:")
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
  ) {
    throw new TypeError(`${name} uses a forbidden URL form`);
  }
  const moduleOrigin = new URL(import.meta.url).origin;
  if (moduleOrigin !== "null" && url.origin !== moduleOrigin) {
    throw new TypeError(`${name} must be a same-origin local asset`);
  }
  return url.href;
}

function parseRuntimeAssets(
  candidate: StudioXAtlasUvRuntimeAssets | undefined,
  limits: ResolvedLimits,
): StudioXAtlasUvRuntimeAssets | null {
  if (candidate === undefined) return null;
  if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ["wasmUrl", "moduleUrl"])) {
    throw new TypeError("xatlas runtime assets are invalid");
  }
  return Object.freeze({
    wasmUrl: parseRuntimeUrl(candidate.wasmUrl, "wasmUrl", limits),
    moduleUrl: parseRuntimeUrl(candidate.moduleUrl, "moduleUrl", limits),
  });
}

function parseEpoch(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    stop("invalid-input", `${name} must be a non-negative safe integer`);
  }
  return value as number;
}

function copyFloat32(
  value: unknown,
  name: string,
  multiple: number,
  shouldCopy = true,
): Float32Array {
  if (!(value instanceof Float32Array) || value.length === 0 || value.length % multiple !== 0) {
    stop("invalid-input", `${name} must be a non-empty Float32Array aligned to ${multiple}`);
  }
  const copy = shouldCopy ? new Float32Array(value) : value;
  for (const item of copy) {
    if (!Number.isFinite(item)) stop("invalid-input", `${name} contains a non-finite value`);
  }
  return copy;
}

function copyIndices(
  value: unknown,
  vertexCount: number,
  name: string,
  shouldCopy = true,
): Uint16Array | Uint32Array {
  if (
    (!(value instanceof Uint16Array) && !(value instanceof Uint32Array))
    || value.length === 0
    || value.length % 3 !== 0
  ) {
    stop("invalid-input", `${name} must be a non-empty triangle index array`);
  }
  const copy = shouldCopy
    ? value instanceof Uint16Array
      ? new Uint16Array(value)
      : new Uint32Array(value)
    : value;
  for (const index of copy) {
    if (index >= vertexCount) stop("invalid-input", `${name} contains an out-of-range vertex`);
  }
  return copy;
}

function assertNoAccessorProperties(value: object, label: string): void {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) {
      stop("invalid-input", `${label}.${key} must not be an accessor property`);
    }
  }
}

function preflightMesh(
  candidate: unknown,
  limits: ResolvedLimits,
): Readonly<{ vertices: number; triangles: number; bytes: number }> {
  if (!isPlainRecord(candidate)) {
    stop("invalid-input", "xatlas mesh metadata is invalid");
  }
  assertNoAccessorProperties(candidate, "mesh");
  const positions = candidate.positions;
  const indices = candidate.indices;
  const normals = candidate.normals;
  const uv = candidate.uv;
  if (
    !(positions instanceof Float32Array)
    || positions.length === 0
    || positions.length % 3 !== 0
    || (
      !(indices instanceof Uint16Array)
      && !(indices instanceof Uint32Array)
    )
    || indices.length === 0
    || indices.length % 3 !== 0
    || (normals !== undefined && !(normals instanceof Float32Array))
    || (uv !== undefined && !(uv instanceof Float32Array))
  ) {
    stop("invalid-input", "xatlas mesh buffers are invalid");
  }
  const vertices = positions.length / 3;
  if (vertices > limits.maxVerticesPerMesh) {
    stop("budget-exceeded", "xatlas per-mesh vertex budget exceeded");
  }
  return {
    vertices,
    triangles: indices.length / 3,
    bytes: positions.byteLength
      + indices.byteLength
      + (normals?.byteLength ?? 0)
      + (uv?.byteLength ?? 0),
  };
}

function parseMesh(
  candidate: unknown,
  seenIds: Set<string>,
  limits: ResolvedLimits,
  shouldCopy: boolean,
): ParsedMesh {
  if (
    !isPlainRecord(candidate)
    || !hasExactKeys(candidate, ["id", "positions", "indices"], ["normals", "uv"])
    || typeof candidate.id !== "string"
    || candidate.id.length === 0
    || candidate.id.length > limits.maxIdentifierCodeUnits
    || candidate.id.trim() !== candidate.id
  ) {
    stop("invalid-input", "xatlas mesh metadata is invalid");
  }
  if (seenIds.has(candidate.id)) stop("invalid-input", "xatlas mesh ids must be unique");
  seenIds.add(candidate.id);

  const positions = copyFloat32(
    candidate.positions,
    `${candidate.id}.positions`,
    3,
    shouldCopy,
  );
  const sourceVertexCount = positions.length / 3;
  if (sourceVertexCount > limits.maxVerticesPerMesh) {
    stop(
      "budget-exceeded",
      `${candidate.id} exceeds the safe xatlasjs per-mesh vertex budget`,
    );
  }
  const indices = copyIndices(
    candidate.indices,
    sourceVertexCount,
    `${candidate.id}.indices`,
    shouldCopy,
  );
  const normals = candidate.normals === undefined
    ? null
    : copyFloat32(candidate.normals, `${candidate.id}.normals`, 3, shouldCopy);
  if (normals !== null && normals.length !== positions.length) {
    stop("invalid-input", `${candidate.id}.normals must match its positions`);
  }
  const uv = candidate.uv === undefined
    ? null
    : copyFloat32(candidate.uv, `${candidate.id}.uv`, 2, shouldCopy);
  if (uv !== null && uv.length !== sourceVertexCount * 2) {
    stop("invalid-input", `${candidate.id}.uv must match its positions`);
  }

  return Object.freeze({
    id: candidate.id,
    positions,
    indices,
    normals,
    uv,
    sourceVertexCount,
    sourceTriangleCount: indices.length / 3,
  });
}

function parseChartOptions(
  candidate: unknown,
  limits: ResolvedLimits,
): StudioXAtlasUvRuntimePackOptions["chart"] {
  if (candidate === undefined) return Object.freeze({});
  if (!isPlainRecord(candidate) || !hasExactKeys(candidate, [], CHART_OPTION_KEYS)) {
    stop("invalid-input", "xatlas chart options contain unknown fields");
  }
  const chart: {
    fixWinding?: boolean;
    maxBoundaryLength?: number;
    maxChartArea?: number;
    maxCost?: number;
    maxIterations?: number;
    normalDeviationWeight?: number;
    normalSeamWeight?: number;
    roundnessWeight?: number;
    straightnessWeight?: number;
    textureSeamWeight?: number;
    useInputMeshUvs?: boolean;
  } = {};
  for (const name of ["fixWinding", "useInputMeshUvs"] as const) {
    const value = candidate[name];
    if (value !== undefined) {
      if (typeof value !== "boolean") stop("invalid-input", `chart.${name} must be boolean`);
      chart[name] = value;
    }
  }
  if (candidate.maxIterations !== undefined) {
    chart.maxIterations = nonNegativeInteger(
      candidate.maxIterations,
      "chart.maxIterations",
      limits.maxChartIterations,
    );
  }
  for (
    const name of [
      "maxBoundaryLength",
      "maxChartArea",
      "maxCost",
      "normalDeviationWeight",
      "normalSeamWeight",
      "roundnessWeight",
      "straightnessWeight",
      "textureSeamWeight",
    ] as const
  ) {
    const value = candidate[name];
    if (value !== undefined) {
      if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || value < 0
        || value > limits.maxChartScalar
      ) {
        stop("invalid-input", `chart.${name} must be a bounded non-negative number`);
      }
      chart[name] = value;
    }
  }
  return Object.freeze(chart);
}

function parseOptions(
  candidate: unknown,
  limits: ResolvedLimits,
): StudioXAtlasUvRuntimePackOptions {
  if (candidate !== undefined && (
    !isPlainRecord(candidate)
    || !hasExactKeys(
      candidate,
      [],
      ["resolution", "padding", "rotateCharts", "texelsPerUnit", "useNormals", "chart"],
    )
  )) {
    stop("invalid-input", "xatlas options contain unknown fields");
  }
  const options = (candidate ?? {}) as Readonly<Record<string, unknown>>;
  const resolution = options.resolution === undefined
    ? 2_048
    : nonNegativeInteger(options.resolution, "resolution", limits.maxAtlasResolution);
  if (resolution < 64) stop("invalid-input", "resolution must be at least 64");
  const padding = options.padding === undefined
    ? 2
    : nonNegativeInteger(options.padding, "padding", limits.maxPadding);
  const rotateCharts = options.rotateCharts ?? true;
  const useNormals = options.useNormals ?? false;
  if (typeof rotateCharts !== "boolean" || typeof useNormals !== "boolean") {
    stop("invalid-input", "rotateCharts and useNormals must be boolean");
  }
  const texelsPerUnit = options.texelsPerUnit === undefined
    ? null
    : boundedPositiveFinite(options.texelsPerUnit, "texelsPerUnit", limits.maxTexelsPerUnit);
  return Object.freeze({
    pack: Object.freeze({
      resolution,
      padding,
      rotateCharts,
      texelsPerUnit,
      createImage: false,
      bruteForce: false,
    }),
    chart: parseChartOptions(options.chart, limits),
    useNormals,
  });
}

function parseRequest(
  candidate: unknown,
  limits: ResolvedLimits,
  shouldCopy: boolean,
): ParsedRequest {
  if (!isPlainRecord(candidate)) {
    stop("invalid-input", "xatlas request is invalid");
  }
  assertNoAccessorProperties(candidate, "request");
  if (
    !hasExactKeys(
      candidate,
      ["operation", "requestEpoch", "documentEpoch", "meshes"],
      ["options"],
    )
    || candidate.operation !== "unwrap-atlas"
    || !Array.isArray(candidate.meshes)
    || candidate.meshes.length === 0
    || candidate.meshes.length > limits.maxMeshes
  ) {
    stop("invalid-input", "xatlas request is invalid");
  }
  assertNoAccessorProperties(candidate.meshes, "meshes");
  let vertices = 0;
  let triangles = 0;
  let bytes = 0;
  for (const mesh of candidate.meshes) {
    const declared = preflightMesh(mesh, limits);
    vertices = checkedAdd(vertices, declared.vertices, "Input vertex count");
    triangles = checkedAdd(triangles, declared.triangles, "Input triangle count");
    bytes = checkedAdd(bytes, declared.bytes, "Input byte count");
    if (vertices > limits.maxVertices) stop("budget-exceeded", "Input vertex budget exceeded");
    if (triangles > limits.maxTriangles) stop("budget-exceeded", "Input triangle budget exceeded");
    if (bytes > limits.maxInputBytes) stop("budget-exceeded", "Input byte budget exceeded");
  }
  if (candidate.options !== undefined) {
    if (!isPlainRecord(candidate.options)) {
      stop("invalid-input", "xatlas options contain unknown fields");
    }
    assertNoAccessorProperties(candidate.options, "options");
    if (candidate.options.chart !== undefined) {
      if (!isPlainRecord(candidate.options.chart)) {
        stop("invalid-input", "xatlas chart options contain unknown fields");
      }
      assertNoAccessorProperties(candidate.options.chart, "chart");
    }
  }
  const seenIds = new Set<string>();
  const meshes = candidate.meshes.map(
    (mesh) => parseMesh(mesh, seenIds, limits, shouldCopy),
  );
  return Object.freeze({
    operation: "unwrap-atlas",
    requestEpoch: parseEpoch(candidate.requestEpoch, "requestEpoch"),
    documentEpoch: parseEpoch(candidate.documentEpoch, "documentEpoch"),
    meshes: Object.freeze(meshes),
    options: parseOptions(candidate.options, limits),
  });
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) stop("cancelled", "xatlas request was cancelled");
}

function normalizeProgress(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

function parseAtlasMetadata(
  atlas: StudioXAtlasUvRuntimeAtlas,
  expectedMeshCount: number,
  limits: ResolvedLimits,
): StudioXAtlasUvAtlasReceipt {
  if (
    !Number.isSafeInteger(atlas.width)
    || atlas.width <= 0
    || atlas.width > limits.maxAtlasResolution
    || !Number.isSafeInteger(atlas.height)
    || atlas.height <= 0
    || atlas.height > limits.maxAtlasResolution
    || !Number.isSafeInteger(atlas.atlasCount)
    || atlas.atlasCount <= 0
    || atlas.atlasCount > limits.maxAtlasCount
    || atlas.meshCount !== expectedMeshCount
    || !Number.isFinite(atlas.texelsPerUnit)
    || atlas.texelsPerUnit <= 0
    || atlas.texelsPerUnit > limits.maxTexelsPerUnit
  ) {
    stop("invalid-provider-output", "xatlas returned invalid atlas metadata");
  }
  return Object.freeze({
    width: atlas.width,
    height: atlas.height,
    count: atlas.atlasCount,
    texelsPerUnit: atlas.texelsPerUnit,
  });
}

function capabilityReceipt(
  runtime: StudioXAtlasUvRuntime,
  source: StudioXAtlasUvCapabilityReceipt["runtimeSource"],
): StudioXAtlasUvCapabilityReceipt {
  return Object.freeze({
    packageName: "xatlasjs",
    packageVersion: runtime.packageVersion,
    runtimeSource: source,
    intendedHost: "dedicated-worker",
    executionTopology: "single-dedicated-worker",
    rendererNeutral: true,
    defensiveInputCopy: true,
    defensiveOutputCopy: true,
    originalInputPreserved: true,
    nativeHandlesReturned: false,
    mainThreadFallback: false,
    atlasCleanup: "direct-destroyAtlas-finally",
    geometryCleanup: "release-typed-array-snapshots",
    wasmCleanup: "dedicated-worker-termination",
  });
}

function buildArtifact(
  atlas: StudioXAtlasUvRuntimeAtlas,
  request: ParsedRequest,
  limits: ResolvedLimits,
  receipt: StudioXAtlasUvCapabilityReceipt,
): StudioXAtlasUvArtifact {
  if (!Array.isArray(atlas.meshes) || atlas.meshes.length !== request.meshes.length) {
    stop("invalid-provider-output", "xatlas returned the wrong mesh count");
  }
  const atlasReceipt = parseAtlasMetadata(atlas, request.meshes.length, limits);
  const outputsById = new Map<string, StudioXAtlasUvRuntimeMeshOutput>();
  for (const output of atlas.meshes) {
    if (
      typeof output !== "object"
      || output === null
      || typeof output.id !== "string"
      || outputsById.has(output.id)
    ) {
      stop("invalid-provider-output", "xatlas returned invalid mesh metadata");
    }
    outputsById.set(output.id, output);
  }

  let declaredVertices = 0;
  let declaredTriangles = 0;
  let declaredBytes = 0;
  for (const input of request.meshes) {
    const output = outputsById.get(input.id);
    if (output === undefined) {
      stop("invalid-provider-output", `xatlas omitted mesh ${input.id}`);
    }
    const positionLength = output.positions?.length;
    const uvLength = output.uv?.length;
    const indexLength = output.indices?.length;
    if (
      !Number.isSafeInteger(positionLength)
      || (positionLength as number) <= 0
      || (positionLength as number) % 3 !== 0
      || !Number.isSafeInteger(uvLength)
      || (uvLength as number) !== ((positionLength as number) / 3) * 2
      || !Number.isSafeInteger(indexLength)
      || (indexLength as number) <= 0
      || (indexLength as number) % 3 !== 0
    ) {
      stop("invalid-provider-output", `${input.id} has invalid output buffer shapes`);
    }
    const vertexCount = (positionLength as number) / 3;
    declaredVertices = checkedAdd(
      declaredVertices,
      vertexCount,
      "Output vertex count",
    );
    declaredTriangles = checkedAdd(
      declaredTriangles,
      (indexLength as number) / 3,
      "Output triangle count",
    );
    declaredBytes = checkedAdd(
      declaredBytes,
      ((positionLength as number) + (uvLength as number)) * 4,
      "Output byte count",
    );
    declaredBytes = checkedAdd(
      declaredBytes,
      (indexLength as number) * 4,
      "Output byte count",
    );
    if (
      vertexCount > limits.maxVerticesPerMesh
      || declaredVertices > limits.maxOutputVertices
      || declaredTriangles > limits.maxOutputTriangles
      || declaredBytes > limits.maxOutputBytes
    ) {
      stop("budget-exceeded", "xatlas output exceeds its declared budgets");
    }
  }
  const positions = new Float32Array(declaredVertices * 3);
  const uv = new Float32Array(declaredVertices * 2);
  const indices = new Uint32Array(declaredTriangles * 3);
  const ranges: StudioXAtlasUvMeshRange[] = [];
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const input of request.meshes) {
    const output = outputsById.get(input.id);
    if (output === undefined) {
      stop("invalid-provider-output", `xatlas omitted mesh ${input.id}`);
    }
    const vertexCount = output.positions.length / 3;
    for (let index = 0; index < output.positions.length; index += 1) {
      const item = output.positions[index];
      if (!Number.isFinite(item)) {
        stop("invalid-provider-output", `${input.id}.positions contains a non-finite value`);
      }
      positions[vertexOffset * 3 + index] = item as number;
    }
    for (let index = 0; index < output.uv.length; index += 1) {
      const item = output.uv[index];
      if (!Number.isFinite(item)) {
        stop("invalid-provider-output", `${input.id}.uv contains a non-finite value`);
      }
      uv[vertexOffset * 2 + index] = item as number;
    }
    for (let index = 0; index < output.indices.length; index += 1) {
      const item = output.indices[index];
      if (
        !Number.isSafeInteger(item)
        || (item as number) < 0
        || (item as number) >= vertexCount
      ) {
        stop("invalid-provider-output", `${input.id}.indices contains an invalid vertex index`);
      }
      indices[indexOffset + index] = (item as number) + vertexOffset;
    }
    const segments = (output.atlasSegments ?? []).map((segment) => {
      if (
        typeof segment !== "object"
        || segment === null
        || !Number.isSafeInteger(segment.index)
        || segment.index < 0
        || !Number.isSafeInteger(segment.count)
        || segment.count <= 0
        || segment.index + segment.count > output.indices.length
        || !Number.isSafeInteger(segment.atlasIndex)
        || segment.atlasIndex < 0
        || segment.atlasIndex >= atlasReceipt.count
      ) {
        stop("invalid-provider-output", `${input.id} has an invalid atlas segment`);
      }
      return Object.freeze({
        indexOffset: indexOffset + segment.index,
        indexCount: segment.count,
        atlasIndex: segment.atlasIndex,
      });
    });
    ranges.push(Object.freeze({
      id: input.id,
      sourceVertexCount: input.sourceVertexCount,
      vertexOffset,
      vertexCount,
      indexOffset,
      indexCount: output.indices.length,
      atlasSegments: Object.freeze(segments),
    }));
    vertexOffset += vertexCount;
    indexOffset += output.indices.length;
  }

  return Object.freeze({
    kind: "studio-xatlas-uv-atlas",
    version: STUDIO_XATLAS_UV_PROVIDER_VERSION,
    positions,
    uv,
    indices,
    meshes: Object.freeze(ranges),
    atlas: atlasReceipt,
    receipt,
  });
}

async function defaultRuntimeLoader(): Promise<StudioXAtlasUvRuntime> {
  const module = await import("./studio-xatlas-uv-provider-runtime");
  return module.createStudioXAtlasUvProductionRuntime();
}

export function studioXAtlasUvFailure(
  reason: StudioXAtlasUvFailureReason,
  detail: string,
  fallback?: StudioXAtlasUvNoFallbackReceipt,
): StudioXAtlasUvFailure {
  return fallback === undefined
    ? Object.freeze({ ok: false, reason, detail })
    : Object.freeze({ ok: false, reason, detail, fallback });
}

export class StudioXAtlasUvProvider {
  private readonly limits: ResolvedLimits;
  private readonly runtimeAssets: StudioXAtlasUvRuntimeAssets | null;
  private readonly runtimeLoader: () => StudioXAtlasUvRuntime | PromiseLike<StudioXAtlasUvRuntime>;
  private readonly runtimeSource: StudioXAtlasUvCapabilityReceipt["runtimeSource"];
  private readonly now: () => number;
  private readonly shouldCopyInput: boolean;
  private runtimePromise: Promise<StudioXAtlasUvRuntime> | null = null;
  private requestEpoch: number;
  private documentEpoch: number;
  private disposed = false;
  private pendingRequestCount = 0;
  private completedRequestCount = 0;
  private rejectedRequestCount = 0;
  private createdGeometryCount = 0;
  private releasedGeometryCount = 0;
  private atlasCleanupAttemptCount = 0;
  private atlasCleanupFailureCount = 0;
  private progressEventCount = 0;
  private readonly idleResolvers: Array<() => void> = [];
  private disposePromise: Promise<void> | null = null;

  constructor(options: StudioXAtlasUvProviderOptions) {
    if (
      !isPlainRecord(options)
      || !hasExactKeys(
        options,
        ["requestEpoch", "documentEpoch"],
        ["runtimeAssets", "limits", "runtimeLoader", "now", "inputOwnership"],
      )
      || !Number.isSafeInteger(options.requestEpoch)
      || options.requestEpoch < 0
      || !Number.isSafeInteger(options.documentEpoch)
      || options.documentEpoch < 0
      || (options.runtimeLoader !== undefined && typeof options.runtimeLoader !== "function")
      || (options.now !== undefined && typeof options.now !== "function")
      || (
        options.inputOwnership !== undefined
        && options.inputOwnership !== "copy"
        && options.inputOwnership !== "transferred"
      )
    ) {
      throw new TypeError("xatlas provider options are invalid");
    }
    const validated = options as StudioXAtlasUvProviderOptions;
    this.limits = resolveLimits(validated.limits);
    this.runtimeAssets = parseRuntimeAssets(
      validated.runtimeAssets,
      this.limits,
    );
    this.runtimeLoader = validated.runtimeLoader ?? defaultRuntimeLoader;
    this.runtimeSource = validated.runtimeLoader === undefined
      ? "package-dynamic-import"
      : "injected";
    this.now = validated.now ?? Date.now;
    this.shouldCopyInput = validated.inputOwnership !== "transferred";
    this.requestEpoch = validated.requestEpoch;
    this.documentEpoch = validated.documentEpoch;
  }

  private loadRuntime(
    onProgress: (mode: unknown, progress: unknown) => void,
  ): Promise<StudioXAtlasUvRuntime> {
    this.runtimePromise ??= Promise.resolve()
      .then(() => this.runtimeLoader())
      .then(async (runtime) => {
        if (
          typeof runtime !== "object"
          || runtime === null
          || typeof runtime.packageVersion !== "string"
          || runtime.packageVersion.length === 0
          || typeof runtime.initialize !== "function"
          || typeof runtime.createGeometry !== "function"
          || typeof runtime.pack !== "function"
          || typeof runtime.cleanupAtlas !== "function"
          || typeof runtime.dispose !== "function"
        ) {
          throw new TypeError("Injected xatlas runtime is invalid");
        }
        try {
          await runtime.initialize(this.runtimeAssets, onProgress);
          return runtime;
        } catch (error) {
          try {
            await runtime.dispose();
          } catch {
            // The initialization error remains authoritative.
          }
          throw error;
        }
      })
      .catch((error: unknown) => {
        this.runtimePromise = null;
        throw error;
      });
    return this.runtimePromise;
  }

  public execute(
    candidate: unknown,
    execution: StudioXAtlasUvExecution = {},
  ): Promise<StudioXAtlasUvResult> {
    if (this.disposed) {
      this.rejectedRequestCount += 1;
      return Promise.resolve(studioXAtlasUvFailure("disposed", "xatlas provider is disposed"));
    }
    if (!isPlainRecord(execution) || !hasExactKeys(execution, [], ["signal", "onProgress"])) {
      this.rejectedRequestCount += 1;
      return Promise.resolve(
        studioXAtlasUvFailure("invalid-input", "xatlas execution options are invalid"),
      );
    }
    let validatedExecution: StudioXAtlasUvExecution;
    try {
      assertNoAccessorProperties(execution, "execution");
      const signal = Object.getOwnPropertyDescriptor(execution, "signal")?.value;
      const onProgress = Object.getOwnPropertyDescriptor(execution, "onProgress")?.value;
      if (
        (signal !== undefined && !(signal instanceof AbortSignal))
        || (onProgress !== undefined && typeof onProgress !== "function")
      ) {
        stop("invalid-input", "xatlas execution options are invalid");
      }
      validatedExecution = Object.freeze({
        ...(signal === undefined ? {} : { signal: signal as AbortSignal }),
        ...(onProgress === undefined
          ? {}
          : { onProgress: onProgress as NonNullable<StudioXAtlasUvExecution["onProgress"]> }),
      });
    } catch {
      this.rejectedRequestCount += 1;
      return Promise.resolve(
        studioXAtlasUvFailure("invalid-input", "xatlas execution options are invalid"),
      );
    }
    let request: ParsedRequest;
    try {
      request = parseRequest(candidate, this.limits, this.shouldCopyInput);
      assertNotCancelled(validatedExecution.signal);
      if (request.requestEpoch !== this.requestEpoch) {
        stop("stale-request-epoch", "xatlas request epoch is stale");
      }
      if (request.documentEpoch !== this.documentEpoch) {
        stop("stale-document-epoch", "xatlas document epoch is stale");
      }
    } catch (error) {
      this.rejectedRequestCount += 1;
      if (error instanceof StudioXAtlasUvStop) {
        return Promise.resolve(studioXAtlasUvFailure(error.reason, error.detail));
      }
      return Promise.resolve(studioXAtlasUvFailure("invalid-input", "xatlas request is invalid"));
    }
    if (this.pendingRequestCount >= this.limits.maxPendingRequests) {
      this.rejectedRequestCount += 1;
      return Promise.resolve(
        studioXAtlasUvFailure("backpressure", "xatlas pending-request budget exceeded"),
      );
    }
    this.pendingRequestCount += 1;
    const admittedRequestEpoch = this.requestEpoch;
    const admittedDocumentEpoch = this.documentEpoch;

    return (async (): Promise<StudioXAtlasUvResult> => {
      const startedAt = this.now();
      const geometries: StudioXAtlasUvRuntimeGeometry[] = [];
      let runtime: StudioXAtlasUvRuntime | null = null;
      let result: StudioXAtlasUvResult;
      let cleanupOkay = true;
      let progressCount = 0;
      let progressFailure: StudioXAtlasUvStop | null = null;
      const onProgress = (modeCandidate: unknown, progressCandidate: unknown): void => {
        progressCount += 1;
        this.progressEventCount += 1;
        if (progressCount > this.limits.maxProgressEvents) {
          progressFailure ??= new StudioXAtlasUvStop(
            "progress-budget-exceeded",
            "xatlas progress-event budget exceeded",
          );
          return;
        }
        if (
          typeof modeCandidate !== "string"
          || modeCandidate.length === 0
          || modeCandidate.length > 128
        ) {
          progressFailure ??= new StudioXAtlasUvStop(
            "invalid-provider-output",
            "xatlas emitted an invalid progress mode",
          );
          return;
        }
        const progress = normalizeProgress(progressCandidate);
        if (progress === null) {
          progressFailure ??= new StudioXAtlasUvStop(
            "invalid-provider-output",
            "xatlas emitted an invalid progress value",
          );
          return;
        }
        if (validatedExecution.onProgress !== undefined) {
          try {
            validatedExecution.onProgress(Object.freeze({
              sequence: progressCount,
              mode: modeCandidate,
              progress,
            }));
          } catch {
            progressFailure ??= new StudioXAtlasUvStop(
              "provider-failure",
              "xatlas progress consumer failed",
            );
          }
        }
      };

      try {
        try {
          runtime = await this.loadRuntime(onProgress);
        } catch {
          stop("provider-unavailable", "xatlas runtime failed to initialize");
        }
        assertNotCancelled(validatedExecution.signal);
        if (progressFailure !== null) throw progressFailure;
        if (this.disposed) stop("disposed", "xatlas provider was disposed during initialization");
        if (admittedRequestEpoch !== this.requestEpoch) {
          stop("stale-request-epoch", "xatlas request became stale before execution");
        }
        if (admittedDocumentEpoch !== this.documentEpoch) {
          stop("stale-document-epoch", "xatlas document became stale before execution");
        }
        if (this.now() - startedAt > this.limits.maxExecutionMs) {
          stop("time-budget-exceeded", "xatlas initialization exceeded its time budget");
        }

        for (const mesh of request.meshes) {
          const geometry = runtime.createGeometry(mesh);
          if (
            typeof geometry !== "object"
            || geometry === null
            || geometry.id !== mesh.id
            || typeof geometry.release !== "function"
          ) {
            stop("invalid-provider-output", "xatlas runtime created an invalid geometry handle");
          }
          geometries.push(geometry);
          this.createdGeometryCount += 1;
        }
        const atlas = await runtime.pack(geometries, request.options, onProgress);
        assertNotCancelled(validatedExecution.signal);
        if (progressFailure !== null) throw progressFailure;
        if (this.now() - startedAt > this.limits.maxExecutionMs) {
          stop("time-budget-exceeded", "xatlas generation exceeded its time budget");
        }
        if (admittedRequestEpoch !== this.requestEpoch) {
          stop("stale-request-epoch", "xatlas request became stale after execution");
        }
        if (admittedDocumentEpoch !== this.documentEpoch) {
          stop("stale-document-epoch", "xatlas document became stale after execution");
        }
        const artifact = buildArtifact(
          atlas,
          request,
          this.limits,
          capabilityReceipt(runtime, this.runtimeSource),
        );
        this.completedRequestCount += 1;
        result = Object.freeze({ ok: true, artifact });
      } catch (error) {
        this.rejectedRequestCount += 1;
        result = error instanceof StudioXAtlasUvStop
          ? studioXAtlasUvFailure(error.reason, error.detail)
          : studioXAtlasUvFailure("provider-failure", "xatlas generation failed closed");
      } finally {
        if (runtime !== null) {
          this.atlasCleanupAttemptCount += 1;
          try {
            cleanupOkay = await runtime.cleanupAtlas();
          } catch {
            cleanupOkay = false;
          }
          if (!cleanupOkay) this.atlasCleanupFailureCount += 1;
        }
        for (let index = geometries.length - 1; index >= 0; index -= 1) {
          try {
            geometries[index]!.release();
          } catch {
            cleanupOkay = false;
          } finally {
            this.releasedGeometryCount += 1;
          }
        }
        this.pendingRequestCount -= 1;
        if (this.pendingRequestCount === 0) {
          for (const resolve of this.idleResolvers.splice(0)) resolve();
        }
      }
      if (!cleanupOkay) {
        if (result.ok) {
          this.completedRequestCount -= 1;
          this.rejectedRequestCount += 1;
        }
        return studioXAtlasUvFailure(
          "cleanup-failure",
          "xatlas native or geometry cleanup failed",
        );
      }
      return result;
    })();
  }

  public advanceEpochs(requestEpoch: number, documentEpoch: number): boolean {
    if (
      this.disposed
      || !Number.isSafeInteger(requestEpoch)
      || requestEpoch < this.requestEpoch
      || !Number.isSafeInteger(documentEpoch)
      || documentEpoch < this.documentEpoch
    ) {
      return false;
    }
    this.requestEpoch = requestEpoch;
    this.documentEpoch = documentEpoch;
    return true;
  }

  public diagnostics(): StudioXAtlasUvProviderDiagnostics {
    return Object.freeze({
      phase: this.disposed ? "disposed" : this.runtimePromise === null ? "cold" : "ready",
      requestEpoch: this.requestEpoch,
      documentEpoch: this.documentEpoch,
      pendingRequestCount: this.pendingRequestCount,
      completedRequestCount: this.completedRequestCount,
      rejectedRequestCount: this.rejectedRequestCount,
      createdGeometryCount: this.createdGeometryCount,
      releasedGeometryCount: this.releasedGeometryCount,
      atlasCleanupAttemptCount: this.atlasCleanupAttemptCount,
      atlasCleanupFailureCount: this.atlasCleanupFailureCount,
      progressEventCount: this.progressEventCount,
    });
  }

  public async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      if (this.pendingRequestCount > 0) {
        await new Promise<void>((resolve) => {
          this.idleResolvers.push(resolve);
        });
      }
      if (this.runtimePromise !== null) {
        try {
          const runtime = await this.runtimePromise;
          await runtime.dispose();
        } catch {
          // Worker termination remains the authoritative WASM cleanup boundary.
        }
      }
      this.runtimePromise = null;
    })();
    return this.disposePromise;
  }
}

export function createStudioXAtlasUvProvider(
  options: StudioXAtlasUvProviderOptions,
): StudioXAtlasUvProvider {
  return new StudioXAtlasUvProvider(options);
}
