import { sha256HexPortable } from "./studio-sha256";

export const STUDIO_THREE_MESH_BVH_PROVIDER_REVISION = 1 as const;

export const STUDIO_THREE_MESH_BVH_BUDGETS = Object.freeze({
  maxVertices: 2_000_000,
  maxTriangles: 2_000_000,
  maxDepth: 48,
  maxTargetLeafSize: 128,
  maxTriangleTestsPerQuery: 250_000,
  maxCandidatesPerQuery: 100_000,
  maxLassoPoints: 512,
  maxCoordinateMagnitude: 1_000_000_000,
  maxConcurrentOperations: 4,
} as const);

export type StudioThreeMeshBvhVec3 = readonly [number, number, number];
export type StudioThreeMeshBvhMat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export interface StudioThreeMeshBvhGeometryStats {
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly indexed: boolean;
  readonly finitePositions: boolean;
}

export type StudioThreeMeshBvhBuildStrategy =
  | "center"
  | "average"
  | "sah";

export interface StudioThreeMeshBvhLocalHit {
  readonly point: StudioThreeMeshBvhVec3;
  readonly normal: StudioThreeMeshBvhVec3 | null;
  readonly distance: number;
  readonly faceIndex: number;
}

export interface StudioThreeMeshBvhRuntimeCandidateResult {
  readonly triangleIndices: readonly number[];
  readonly triangleTests: number;
  readonly truncated: boolean;
}

export type StudioThreeMeshBvhLocalShape =
  | Readonly<{
      kind: "sphere";
      center: StudioThreeMeshBvhVec3;
      radius: number;
    }>
  | Readonly<{
      kind: "box";
      min: StudioThreeMeshBvhVec3;
      max: StudioThreeMeshBvhVec3;
    }>;

export interface StudioThreeMeshBvhRuntime {
  readonly version: string;
  inspectGeometry(geometry: unknown): StudioThreeMeshBvhGeometryStats;
  build(
    geometry: unknown,
    options: Readonly<{
      strategy: StudioThreeMeshBvhBuildStrategy;
      maxDepth: number;
      targetLeafSize: number;
      indirect: true;
      attachToGeometry: boolean;
      signal?: AbortSignal;
    }>,
  ): unknown;
  raycastFirst(
    boundsTree: unknown,
    ray: Readonly<{
      origin: StudioThreeMeshBvhVec3;
      direction: StudioThreeMeshBvhVec3;
      near: number;
      far: number;
    }>,
  ): StudioThreeMeshBvhLocalHit | null;
  closestPoint(
    boundsTree: unknown,
    point: StudioThreeMeshBvhVec3,
    maxDistance: number,
  ): StudioThreeMeshBvhLocalHit | null;
  shapeCandidates(
    boundsTree: unknown,
    shape: StudioThreeMeshBvhLocalShape,
    limits: Readonly<{
      maxTriangleTests: number;
      maxCandidates: number;
    }>,
  ): StudioThreeMeshBvhRuntimeCandidateResult;
  lassoCandidates(
    boundsTree: unknown,
    input: Readonly<{
      localToWorld: StudioThreeMeshBvhMat4;
      worldToClip: StudioThreeMeshBvhMat4;
      polygonNdc: readonly (readonly [number, number])[];
      selection: "centroid" | "any-vertex";
      maxTriangleTests: number;
      maxCandidates: number;
    }>,
  ): StudioThreeMeshBvhRuntimeCandidateResult;
  refit(boundsTree: unknown, signal?: AbortSignal): void;
  disposeBoundsTree(
    boundsTree: unknown,
    geometry: unknown,
    attachedToGeometry: boolean,
  ): void;
  disposeGeometry(geometry: unknown): void;
  destroy(): Promise<void> | void;
}

export type StudioThreeMeshBvhRuntimeLoader =
  () => Promise<StudioThreeMeshBvhRuntime> | StudioThreeMeshBvhRuntime;

export interface StudioThreeMeshBvhCoordinateContract {
  readonly inputSpace: "world";
  readonly accelerationSpace: "geometry-local";
  readonly outputSpaces: readonly ["geometry-local", "world"];
  readonly matrixEncoding: "column-major-f64";
  readonly localToWorld: StudioThreeMeshBvhMat4;
  readonly worldToLocal: StudioThreeMeshBvhMat4;
}

export interface StudioThreeMeshBvhHitArtifact {
  readonly faceIndex: number;
  readonly localPoint: StudioThreeMeshBvhVec3;
  readonly worldPoint: StudioThreeMeshBvhVec3;
  readonly localNormal: StudioThreeMeshBvhVec3 | null;
  readonly worldNormal: StudioThreeMeshBvhVec3 | null;
  readonly localDistance: number;
  readonly worldDistance: number;
  readonly geometryEpoch: number;
  readonly coordinates: StudioThreeMeshBvhCoordinateContract;
}

export interface StudioThreeMeshBvhBuildReceipt {
  readonly kind: "studio-three-mesh-bvh-build-receipt";
  readonly revision: typeof STUDIO_THREE_MESH_BVH_PROVIDER_REVISION;
  readonly providerId: "three-mesh-bvh";
  readonly runtimeVersion: string;
  readonly geometryEpoch: number;
  readonly geometry: StudioThreeMeshBvhGeometryStats;
  readonly strategy: StudioThreeMeshBvhBuildStrategy;
  readonly maxDepth: number;
  readonly targetLeafSize: number;
  readonly indirect: true;
  readonly ownership: {
    readonly geometry: "borrowed" | "provider-owned";
    readonly boundsTree: "private" | "geometry-attached";
  };
  readonly coordinates: StudioThreeMeshBvhCoordinateContract;
  readonly receiptHash: `sha256:${string}`;
}

export interface StudioThreeMeshBvhQueryReceipt<Result> {
  readonly kind: "studio-three-mesh-bvh-query-receipt";
  readonly revision: typeof STUDIO_THREE_MESH_BVH_PROVIDER_REVISION;
  readonly providerId: "three-mesh-bvh";
  readonly query:
    | "raycast-first"
    | "closest-surface"
    | "sphere-candidates"
    | "box-candidates"
    | "lasso-candidates";
  readonly geometryEpoch: number;
  readonly queryHash: `sha256:${string}`;
  readonly result: Result;
}

export interface StudioThreeMeshBvhCandidateArtifact {
  readonly triangleIndices: readonly number[];
  readonly triangleTests: number;
  readonly truncated: boolean;
  readonly geometryEpoch: number;
  readonly coordinates: StudioThreeMeshBvhCoordinateContract;
  readonly containment:
    | "exact-local-shape"
    | "conservative-world-shape"
    | "projected-ndc";
}

export class StudioThreeMeshBvhProviderError extends Error {
  constructor(
    readonly code:
      | "invalid-request"
      | "budget-exceeded"
      | "epoch-mismatch"
      | "backpressure"
      | "aborted"
      | "runtime-failed"
      | "invalid-runtime-output"
      | "disposed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioThreeMeshBvhProviderError";
  }
}

export interface StudioThreeMeshBvhProvider {
  build(signal?: AbortSignal): Promise<StudioThreeMeshBvhBuildReceipt>;
  raycastFirst(input: Readonly<{
    originWorld: StudioThreeMeshBvhVec3;
    directionWorld: StudioThreeMeshBvhVec3;
    nearWorld?: number;
    farWorld?: number;
    expectedGeometryEpoch?: number;
    signal?: AbortSignal;
  }>): Promise<
    StudioThreeMeshBvhQueryReceipt<StudioThreeMeshBvhHitArtifact | null>
  >;
  closestSurface(input: Readonly<{
    pointWorld: StudioThreeMeshBvhVec3;
    maxDistanceWorld?: number;
    expectedGeometryEpoch?: number;
    signal?: AbortSignal;
  }>): Promise<
    StudioThreeMeshBvhQueryReceipt<StudioThreeMeshBvhHitArtifact | null>
  >;
  shapeCandidates(input:
    | Readonly<{
        kind: "sphere";
        centerWorld: StudioThreeMeshBvhVec3;
        radiusWorld: number;
        expectedGeometryEpoch?: number;
        signal?: AbortSignal;
      }>
    | Readonly<{
        kind: "box";
        minWorld: StudioThreeMeshBvhVec3;
        maxWorld: StudioThreeMeshBvhVec3;
        expectedGeometryEpoch?: number;
        signal?: AbortSignal;
      }>
  ): Promise<
    StudioThreeMeshBvhQueryReceipt<StudioThreeMeshBvhCandidateArtifact>
  >;
  lassoCandidates(input: Readonly<{
    polygonNdc: readonly (readonly [number, number])[];
    worldToClip: StudioThreeMeshBvhMat4;
    selection?: "centroid" | "any-vertex";
    expectedGeometryEpoch?: number;
    signal?: AbortSignal;
  }>): Promise<
    StudioThreeMeshBvhQueryReceipt<StudioThreeMeshBvhCandidateArtifact>
  >;
  refit(input: Readonly<{
    expectedGeometryEpoch: number;
    nextGeometryEpoch: number;
    signal?: AbortSignal;
  }>): Promise<Readonly<{
    kind: "studio-three-mesh-bvh-refit-receipt";
    revision: typeof STUDIO_THREE_MESH_BVH_PROVIDER_REVISION;
    providerId: "three-mesh-bvh";
    previousGeometryEpoch: number;
    geometryEpoch: number;
  }>>;
  snapshot(): Readonly<{
    state: "ready" | "destroying" | "destroyed";
    built: boolean;
    runtimeLoaded: boolean;
    geometryEpoch: number;
    activeOperations: number;
  }>;
  destroy(): Promise<void>;
}

interface PreparedProviderOptions {
  readonly geometry: unknown;
  readonly geometryOwnership: "borrowed" | "provider-owned";
  readonly attachBoundsTreeToGeometry: boolean;
  readonly localToWorld: StudioThreeMeshBvhMat4;
  readonly worldToLocal: StudioThreeMeshBvhMat4;
  readonly geometryEpoch: number;
  readonly strategy: StudioThreeMeshBvhBuildStrategy;
  readonly maxDepth: number;
  readonly targetLeafSize: number;
  readonly allowRefit: boolean;
  readonly runtimeLoader: StudioThreeMeshBvhRuntimeLoader;
}

const BUILD_STRATEGIES = new Set<StudioThreeMeshBvhBuildStrategy>([
  "center",
  "average",
  "sah",
]);

function digestText(value: string): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(value))}`;
}

function invalid(message: string): never {
  throw new StudioThreeMeshBvhProviderError("invalid-request", message);
}

function budget(message: string): never {
  throw new StudioThreeMeshBvhProviderError("budget-exceeded", message);
}

function aborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new StudioThreeMeshBvhProviderError(
      "aborted",
      "Three mesh BVH operation was aborted.",
    );
  }
}

function finiteVec3(
  value: StudioThreeMeshBvhVec3,
  label: string,
): StudioThreeMeshBvhVec3 {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some(
      (component) =>
        !Number.isFinite(component)
        || Math.abs(component)
          > STUDIO_THREE_MESH_BVH_BUDGETS.maxCoordinateMagnitude,
    )
  ) {
    invalid(`${label} must be a bounded finite vec3.`);
  }
  return [value[0], value[1], value[2]];
}

function finiteMatrix(
  value: StudioThreeMeshBvhMat4,
  label: string,
  affine: boolean,
): StudioThreeMeshBvhMat4 {
  if (
    !Array.isArray(value)
    || value.length !== 16
    || value.some((component) => !Number.isFinite(component))
  ) {
    invalid(`${label} must be a finite column-major mat4.`);
  }
  if (
    affine
    && (
      Math.abs(value[3]) > 1e-12
      || Math.abs(value[7]) > 1e-12
      || Math.abs(value[11]) > 1e-12
      || Math.abs(value[15] - 1) > 1e-12
    )
  ) {
    invalid(`${label} must be affine.`);
  }
  return [...value] as unknown as StudioThreeMeshBvhMat4;
}

function invertAffine(
  matrix: StudioThreeMeshBvhMat4,
): StudioThreeMeshBvhMat4 {
  const [
    a00, a10, a20, , a01, a11, a21, , a02, a12, a22, ,
    tx, ty, tz,
  ] = matrix;
  const c00 = a11 * a22 - a12 * a21;
  const c01 = a02 * a21 - a01 * a22;
  const c02 = a01 * a12 - a02 * a11;
  const determinant = a00 * c00 + a10 * c01 + a20 * c02;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    invalid("localToWorld must be invertible.");
  }
  const inverseDeterminant = 1 / determinant;
  const b00 = c00 * inverseDeterminant;
  const b01 = (a12 * a20 - a10 * a22) * inverseDeterminant;
  const b02 = (a10 * a21 - a11 * a20) * inverseDeterminant;
  const b10 = c01 * inverseDeterminant;
  const b11 = (a00 * a22 - a02 * a20) * inverseDeterminant;
  const b12 = (a01 * a20 - a00 * a21) * inverseDeterminant;
  const b20 = c02 * inverseDeterminant;
  const b21 = (a02 * a10 - a00 * a12) * inverseDeterminant;
  const b22 = (a00 * a11 - a01 * a10) * inverseDeterminant;
  return [
    b00, b01, b02, 0,
    b10, b11, b12, 0,
    b20, b21, b22, 0,
    -(b00 * tx + b10 * ty + b20 * tz),
    -(b01 * tx + b11 * ty + b21 * tz),
    -(b02 * tx + b12 * ty + b22 * tz),
    1,
  ];
}

function transformPoint(
  matrix: StudioThreeMeshBvhMat4,
  point: StudioThreeMeshBvhVec3,
): StudioThreeMeshBvhVec3 {
  const [x, y, z] = point;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function normalize(
  vector: StudioThreeMeshBvhVec3,
  label: string,
): StudioThreeMeshBvhVec3 {
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length < 1e-12) {
    invalid(`${label} must have non-zero length.`);
  }
  return [
    vector[0] / length,
    vector[1] / length,
    vector[2] / length,
  ];
}

function transformDirection(
  matrix: StudioThreeMeshBvhMat4,
  vector: StudioThreeMeshBvhVec3,
): StudioThreeMeshBvhVec3 {
  return normalize([
    matrix[0] * vector[0] + matrix[4] * vector[1] + matrix[8] * vector[2],
    matrix[1] * vector[0] + matrix[5] * vector[1] + matrix[9] * vector[2],
    matrix[2] * vector[0] + matrix[6] * vector[1] + matrix[10] * vector[2],
  ], "transformed direction");
}

function transformNormalToWorld(
  worldToLocal: StudioThreeMeshBvhMat4,
  normal: StudioThreeMeshBvhVec3,
): StudioThreeMeshBvhVec3 {
  return normalize([
    worldToLocal[0] * normal[0]
      + worldToLocal[1] * normal[1]
      + worldToLocal[2] * normal[2],
    worldToLocal[4] * normal[0]
      + worldToLocal[5] * normal[1]
      + worldToLocal[6] * normal[2],
    worldToLocal[8] * normal[0]
      + worldToLocal[9] * normal[1]
      + worldToLocal[10] * normal[2],
  ], "transformed normal");
}

function distance(
  left: StudioThreeMeshBvhVec3,
  right: StudioThreeMeshBvhVec3,
): number {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function coordinateContract(
  options: PreparedProviderOptions,
): StudioThreeMeshBvhCoordinateContract {
  return {
    inputSpace: "world",
    accelerationSpace: "geometry-local",
    outputSpaces: ["geometry-local", "world"],
    matrixEncoding: "column-major-f64",
    localToWorld: [...options.localToWorld] as StudioThreeMeshBvhMat4,
    worldToLocal: [...options.worldToLocal] as StudioThreeMeshBvhMat4,
  };
}

function validateStats(
  stats: StudioThreeMeshBvhGeometryStats,
): StudioThreeMeshBvhGeometryStats {
  if (
    !stats
    || !Number.isSafeInteger(stats.vertexCount)
    || stats.vertexCount < 3
    || stats.vertexCount > STUDIO_THREE_MESH_BVH_BUDGETS.maxVertices
    || !Number.isSafeInteger(stats.triangleCount)
    || stats.triangleCount < 1
    || stats.triangleCount > STUDIO_THREE_MESH_BVH_BUDGETS.maxTriangles
    || typeof stats.indexed !== "boolean"
    || stats.finitePositions !== true
  ) {
    budget("Three geometry exceeds BVH build budgets or contains invalid positions.");
  }
  return {
    vertexCount: stats.vertexCount,
    triangleCount: stats.triangleCount,
    indexed: stats.indexed,
    finitePositions: true,
  };
}

function validateLocalHit(
  value: StudioThreeMeshBvhLocalHit,
  triangleCount: number,
): StudioThreeMeshBvhLocalHit {
  const pointIsValid = Array.isArray(value?.point)
    && value.point.length === 3
    && value.point.every(
      (component) =>
        Number.isFinite(component)
        && Math.abs(component)
          <= STUDIO_THREE_MESH_BVH_BUDGETS.maxCoordinateMagnitude,
    );
  const normalIsValid = value?.normal === null
    || (
      Array.isArray(value?.normal)
      && value.normal.length === 3
      && value.normal.every(
        (component) =>
          Number.isFinite(component)
          && Math.abs(component)
            <= STUDIO_THREE_MESH_BVH_BUDGETS.maxCoordinateMagnitude,
      )
      && Math.hypot(...value.normal) >= 1e-12
    );
  if (
    !pointIsValid
    || !normalIsValid
    || !Number.isFinite(value?.distance)
    || value.distance < 0
    || !Number.isSafeInteger(value.faceIndex)
    || value.faceIndex < 0
    || value.faceIndex >= triangleCount
  ) {
    throw new StudioThreeMeshBvhProviderError(
      "invalid-runtime-output",
      "Three mesh BVH runtime returned an invalid hit.",
    );
  }
  const point = [...value.point] as unknown as StudioThreeMeshBvhVec3;
  const normal = value.normal === null
    ? null
    : normalize(
        [...value.normal] as unknown as StudioThreeMeshBvhVec3,
        "runtime normal",
      );
  return {
    point,
    normal,
    distance: value.distance,
    faceIndex: value.faceIndex,
  };
}

function projectHit(
  hit: StudioThreeMeshBvhLocalHit,
  worldReference: StudioThreeMeshBvhVec3,
  geometryEpoch: number,
  options: PreparedProviderOptions,
): StudioThreeMeshBvhHitArtifact {
  const worldPoint = transformPoint(options.localToWorld, hit.point);
  return {
    faceIndex: hit.faceIndex,
    localPoint: [...hit.point] as StudioThreeMeshBvhVec3,
    worldPoint,
    localNormal: hit.normal
      ? [...hit.normal] as StudioThreeMeshBvhVec3
      : null,
    worldNormal: hit.normal
      ? transformNormalToWorld(options.worldToLocal, hit.normal)
      : null,
    localDistance: hit.distance,
    worldDistance: distance(worldReference, worldPoint),
    geometryEpoch,
    coordinates: coordinateContract(options),
  };
}

function prepareOptions(options: Readonly<{
  geometry: unknown;
  three?: typeof import("three");
  runtimeLoader?: StudioThreeMeshBvhRuntimeLoader;
  geometryOwnership?: "borrowed" | "provider-owned";
  boundsTreeOwnership?: "private" | "geometry-attached";
  localToWorld?: StudioThreeMeshBvhMat4;
  geometryEpoch?: number;
  strategy?: StudioThreeMeshBvhBuildStrategy;
  maxDepth?: number;
  targetLeafSize?: number;
  allowRefit?: boolean;
}>): PreparedProviderOptions {
  if (!options || typeof options !== "object" || !options.geometry) {
    invalid("A Three BufferGeometry handle is required.");
  }
  const localToWorld = finiteMatrix(
    options.localToWorld ?? [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    "localToWorld",
    true,
  );
  const geometryEpoch = options.geometryEpoch ?? 0;
  if (!Number.isSafeInteger(geometryEpoch) || geometryEpoch < 0) {
    invalid("geometryEpoch must be a non-negative safe integer.");
  }
  const strategy = options.strategy ?? "sah";
  if (!BUILD_STRATEGIES.has(strategy)) invalid("Unsupported BVH build strategy.");
  const maxDepth = options.maxDepth ?? 40;
  const targetLeafSize = options.targetLeafSize ?? 10;
  if (
    !Number.isSafeInteger(maxDepth)
    || maxDepth < 1
    || maxDepth > STUDIO_THREE_MESH_BVH_BUDGETS.maxDepth
    || !Number.isSafeInteger(targetLeafSize)
    || targetLeafSize < 1
    || targetLeafSize > STUDIO_THREE_MESH_BVH_BUDGETS.maxTargetLeafSize
  ) {
    invalid("BVH build options exceed their bounded ranges.");
  }
  const runtimeLoader = options.runtimeLoader
    ?? (() => {
      if (!options.three) {
        throw new StudioThreeMeshBvhProviderError(
          "invalid-request",
          "The default BVH adapter requires an injected Three namespace.",
        );
      }
      return loadStudioThreeMeshBvhRuntime(options.three);
    });
  return {
    geometry: options.geometry,
    geometryOwnership: options.geometryOwnership ?? "borrowed",
    attachBoundsTreeToGeometry:
      (options.boundsTreeOwnership ?? "private") === "geometry-attached",
    localToWorld,
    worldToLocal: invertAffine(localToWorld),
    geometryEpoch,
    strategy,
    maxDepth,
    targetLeafSize,
    allowRefit: options.allowRefit ?? false,
    runtimeLoader,
  };
}

function candidateArtifact(
  value: StudioThreeMeshBvhRuntimeCandidateResult,
  triangleCount: number,
  geometryEpoch: number,
  containment: StudioThreeMeshBvhCandidateArtifact["containment"],
  options: PreparedProviderOptions,
): StudioThreeMeshBvhCandidateArtifact {
  if (
    !value
    || !Array.isArray(value.triangleIndices)
    || value.triangleIndices.length
      > STUDIO_THREE_MESH_BVH_BUDGETS.maxCandidatesPerQuery
    || !Number.isSafeInteger(value.triangleTests)
    || value.triangleTests < 0
    || value.triangleTests
      > STUDIO_THREE_MESH_BVH_BUDGETS.maxTriangleTestsPerQuery
    || typeof value.truncated !== "boolean"
  ) {
    throw new StudioThreeMeshBvhProviderError(
      "invalid-runtime-output",
      "Three mesh BVH runtime returned invalid candidates.",
    );
  }
  const triangleIndices = value.triangleIndices.map((index) => {
    if (
      !Number.isSafeInteger(index)
      || index < 0
      || index >= triangleCount
    ) {
      throw new StudioThreeMeshBvhProviderError(
        "invalid-runtime-output",
        "Three mesh BVH runtime returned an invalid triangle index.",
      );
    }
    return index;
  });
  if (new Set(triangleIndices).size !== triangleIndices.length) {
    throw new StudioThreeMeshBvhProviderError(
      "invalid-runtime-output",
      "Three mesh BVH runtime returned duplicate triangle candidates.",
    );
  }
  return {
    triangleIndices,
    triangleTests: value.triangleTests,
    truncated: value.truncated,
    geometryEpoch,
    coordinates: coordinateContract(options),
    containment,
  };
}

function conservativeSphereRadius(
  worldToLocal: StudioThreeMeshBvhMat4,
  radiusWorld: number,
): number {
  const linearFrobeniusNorm = Math.hypot(
    worldToLocal[0], worldToLocal[1], worldToLocal[2],
    worldToLocal[4], worldToLocal[5], worldToLocal[6],
    worldToLocal[8], worldToLocal[9], worldToLocal[10],
  );
  return radiusWorld * linearFrobeniusNorm;
}

function conservativeLocalBox(
  minWorld: StudioThreeMeshBvhVec3,
  maxWorld: StudioThreeMeshBvhVec3,
  worldToLocal: StudioThreeMeshBvhMat4,
): Readonly<{
  min: StudioThreeMeshBvhVec3;
  max: StudioThreeMeshBvhVec3;
}> {
  const points: StudioThreeMeshBvhVec3[] = [];
  for (const x of [minWorld[0], maxWorld[0]]) {
    for (const y of [minWorld[1], maxWorld[1]]) {
      for (const z of [minWorld[2], maxWorld[2]]) {
        points.push(transformPoint(worldToLocal, [x, y, z]));
      }
    }
  }
  return {
    min: [
      Math.min(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.min(...points.map((point) => point[2])),
    ],
    max: [
      Math.max(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[2])),
    ],
  };
}

function asProviderError(error: unknown): StudioThreeMeshBvhProviderError {
  if (error instanceof StudioThreeMeshBvhProviderError) return error;
  if (
    error instanceof Error
    && error.name === "AbortError"
  ) {
    return new StudioThreeMeshBvhProviderError(
      "aborted",
      "Three mesh BVH operation was aborted.",
      { cause: error },
    );
  }
  return new StudioThreeMeshBvhProviderError(
    "runtime-failed",
    "Three mesh BVH runtime failed.",
    { cause: error },
  );
}

export function createStudioThreeMeshBvhProvider(
  inputOptions: Readonly<{
    geometry: unknown;
    three?: typeof import("three");
    runtimeLoader?: StudioThreeMeshBvhRuntimeLoader;
    geometryOwnership?: "borrowed" | "provider-owned";
    boundsTreeOwnership?: "private" | "geometry-attached";
    localToWorld?: StudioThreeMeshBvhMat4;
    geometryEpoch?: number;
    strategy?: StudioThreeMeshBvhBuildStrategy;
    maxDepth?: number;
    targetLeafSize?: number;
    allowRefit?: boolean;
  }>,
): StudioThreeMeshBvhProvider {
  const options = prepareOptions(inputOptions);
  let state: "ready" | "destroying" | "destroyed" = "ready";
  let geometryEpoch = options.geometryEpoch;
  let runtimePromise: Promise<StudioThreeMeshBvhRuntime> | null = null;
  let runtime: StudioThreeMeshBvhRuntime | null = null;
  let boundsTree: unknown = null;
  let geometryStats: StudioThreeMeshBvhGeometryStats | null = null;
  let buildReceipt: StudioThreeMeshBvhBuildReceipt | null = null;
  let buildPromise: Promise<StudioThreeMeshBvhBuildReceipt> | null = null;
  let activeOperations = 0;
  let resolveIdle: (() => void) | null = null;
  let destroyPromise: Promise<void> | null = null;

  const loadRuntime = (): Promise<StudioThreeMeshBvhRuntime> => {
    if (runtime) return Promise.resolve(runtime);
    if (!runtimePromise) {
      runtimePromise = Promise.resolve()
        .then(options.runtimeLoader)
        .then((loaded) => {
          runtime = loaded;
          return loaded;
        })
        .catch((error: unknown) => {
          runtimePromise = null;
          throw error;
        });
    }
    return runtimePromise;
  };

  const enter = (signal?: AbortSignal): void => {
    if (state !== "ready") {
      throw new StudioThreeMeshBvhProviderError(
        "disposed",
        "Three mesh BVH provider is not ready.",
      );
    }
    aborted(signal);
    if (
      activeOperations
      >= STUDIO_THREE_MESH_BVH_BUDGETS.maxConcurrentOperations
    ) {
      throw new StudioThreeMeshBvhProviderError(
        "backpressure",
        "Three mesh BVH operation budget exceeded.",
      );
    }
    activeOperations += 1;
  };

  const leave = (): void => {
    activeOperations -= 1;
    if (activeOperations === 0) {
      resolveIdle?.();
      resolveIdle = null;
    }
  };

  const ensureEpoch = (expected?: number): void => {
    if (expected !== undefined && expected !== geometryEpoch) {
      throw new StudioThreeMeshBvhProviderError(
        "epoch-mismatch",
        "Three mesh BVH geometry epoch does not match.",
      );
    }
  };

  const buildInternal = async (
    signal?: AbortSignal,
  ): Promise<StudioThreeMeshBvhBuildReceipt> => {
    if (buildReceipt) return buildReceipt;
    if (buildPromise) return buildPromise;
    buildPromise = (async () => {
      const loaded = await loadRuntime();
      aborted(signal);
      const stats = validateStats(loaded.inspectGeometry(options.geometry));
      const handle = loaded.build(options.geometry, {
        strategy: options.strategy,
        maxDepth: options.maxDepth,
        targetLeafSize: options.targetLeafSize,
        indirect: true,
        attachToGeometry: options.attachBoundsTreeToGeometry,
        ...(signal ? { signal } : {}),
      });
      if (!handle) {
        throw new StudioThreeMeshBvhProviderError(
          "invalid-runtime-output",
          "Three mesh BVH runtime returned an empty bounds tree handle.",
        );
      }
      boundsTree = handle;
      geometryStats = stats;
      const coordinates = coordinateContract(options);
      const receiptWithoutHash = {
        kind: "studio-three-mesh-bvh-build-receipt" as const,
        revision: STUDIO_THREE_MESH_BVH_PROVIDER_REVISION,
        providerId: "three-mesh-bvh" as const,
        runtimeVersion: loaded.version,
        geometryEpoch,
        geometry: stats,
        strategy: options.strategy,
        maxDepth: options.maxDepth,
        targetLeafSize: options.targetLeafSize,
        indirect: true as const,
        ownership: {
          geometry: options.geometryOwnership,
          boundsTree: options.attachBoundsTreeToGeometry
            ? "geometry-attached" as const
            : "private" as const,
        },
        coordinates,
      };
      buildReceipt = {
        ...receiptWithoutHash,
        receiptHash: digestText(JSON.stringify(receiptWithoutHash)),
      };
      return buildReceipt;
    })().catch((error: unknown) => {
      buildPromise = null;
      throw error;
    });
    return buildPromise;
  };

  const withOperation = async <Result>(
    signal: AbortSignal | undefined,
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    enter(signal);
    try {
      const result = await operation();
      aborted(signal);
      return result;
    } catch (error) {
      throw asProviderError(error);
    } finally {
      leave();
    }
  };

  const provider: StudioThreeMeshBvhProvider = {
    build(signal) {
      return withOperation(signal, () => buildInternal(signal));
    },

    raycastFirst(input) {
      return withOperation(input.signal, async () => {
        ensureEpoch(input.expectedGeometryEpoch);
        await buildInternal(input.signal);
        if (!runtime || !boundsTree || !geometryStats) {
          throw new StudioThreeMeshBvhProviderError(
            "runtime-failed",
            "Three mesh BVH was not initialized.",
          );
        }
        const originWorld = finiteVec3(input.originWorld, "originWorld");
        const directionWorld = normalize(
          finiteVec3(input.directionWorld, "directionWorld"),
          "directionWorld",
        );
        const nearWorld = input.nearWorld ?? 0;
        const farWorld = input.farWorld ?? Number.MAX_VALUE;
        if (
          !Number.isFinite(nearWorld)
          || nearWorld < 0
          || (!Number.isFinite(farWorld) && farWorld !== Number.MAX_VALUE)
          || farWorld < nearWorld
        ) {
          invalid("Ray near/far range is invalid.");
        }
        const localOrigin = transformPoint(options.worldToLocal, originWorld);
        const localDirection = transformDirection(
          options.worldToLocal,
          directionWorld,
        );
        const localNearPoint = transformPoint(options.worldToLocal, [
          originWorld[0] + directionWorld[0] * nearWorld,
          originWorld[1] + directionWorld[1] * nearWorld,
          originWorld[2] + directionWorld[2] * nearWorld,
        ]);
        const localFar = farWorld === Number.MAX_VALUE
          ? Number.MAX_VALUE
          : distance(
              localOrigin,
              transformPoint(options.worldToLocal, [
                originWorld[0] + directionWorld[0] * farWorld,
                originWorld[1] + directionWorld[1] * farWorld,
                originWorld[2] + directionWorld[2] * farWorld,
              ]),
            );
        const localNear = distance(localOrigin, localNearPoint);
        const localHit = runtime.raycastFirst(boundsTree, {
          origin: localOrigin,
          direction: localDirection,
          near: localNear,
          far: localFar,
        });
        const projected = localHit
          ? projectHit(
              validateLocalHit(localHit, geometryStats.triangleCount),
              originWorld,
              geometryEpoch,
              options,
            )
          : null;
        const result = projected
          && projected.worldDistance >= nearWorld
          && projected.worldDistance <= farWorld
          ? projected
          : null;
        const queryPayload = {
          originWorld,
          directionWorld,
          nearWorld,
          farWorld,
          geometryEpoch,
        };
        return {
          kind: "studio-three-mesh-bvh-query-receipt",
          revision: STUDIO_THREE_MESH_BVH_PROVIDER_REVISION,
          providerId: "three-mesh-bvh",
          query: "raycast-first",
          geometryEpoch,
          queryHash: digestText(JSON.stringify(queryPayload)),
          result,
        };
      });
    },

    closestSurface(input) {
      return withOperation(input.signal, async () => {
        ensureEpoch(input.expectedGeometryEpoch);
        await buildInternal(input.signal);
        if (!runtime || !boundsTree || !geometryStats) {
          throw new StudioThreeMeshBvhProviderError(
            "runtime-failed",
            "Three mesh BVH was not initialized.",
          );
        }
        const pointWorld = finiteVec3(input.pointWorld, "pointWorld");
        const maxDistanceWorld = input.maxDistanceWorld ?? Number.MAX_VALUE;
        if (
          maxDistanceWorld !== Number.MAX_VALUE
          && (!Number.isFinite(maxDistanceWorld) || maxDistanceWorld < 0)
        ) {
          invalid("maxDistanceWorld must be non-negative.");
        }
        const pointLocal = transformPoint(options.worldToLocal, pointWorld);
        const localScaleBound = Math.hypot(
          options.worldToLocal[0], options.worldToLocal[1], options.worldToLocal[2],
          options.worldToLocal[4], options.worldToLocal[5], options.worldToLocal[6],
          options.worldToLocal[8], options.worldToLocal[9], options.worldToLocal[10],
        );
        const localHit = runtime.closestPoint(
          boundsTree,
          pointLocal,
          maxDistanceWorld === Number.MAX_VALUE
            ? Number.MAX_VALUE
            : maxDistanceWorld * localScaleBound,
        );
        const projected = localHit
          ? projectHit(
              validateLocalHit(localHit, geometryStats.triangleCount),
              pointWorld,
              geometryEpoch,
              options,
            )
          : null;
        const result = projected
          && projected.worldDistance <= maxDistanceWorld
          ? projected
          : null;
        return {
          kind: "studio-three-mesh-bvh-query-receipt",
          revision: STUDIO_THREE_MESH_BVH_PROVIDER_REVISION,
          providerId: "three-mesh-bvh",
          query: "closest-surface",
          geometryEpoch,
          queryHash: digestText(JSON.stringify({
            pointWorld,
            maxDistanceWorld,
            geometryEpoch,
          })),
          result,
        };
      });
    },

    shapeCandidates(input) {
      return withOperation(input.signal, async () => {
        ensureEpoch(input.expectedGeometryEpoch);
        await buildInternal(input.signal);
        if (!runtime || !boundsTree || !geometryStats) {
          throw new StudioThreeMeshBvhProviderError(
            "runtime-failed",
            "Three mesh BVH was not initialized.",
          );
        }
        let localShape: StudioThreeMeshBvhLocalShape;
        let queryPayload:
          | Readonly<{
              kind: "sphere";
              centerWorld: StudioThreeMeshBvhVec3;
              radiusWorld: number;
              geometryEpoch: number;
            }>
          | Readonly<{
              kind: "box";
              minWorld: StudioThreeMeshBvhVec3;
              maxWorld: StudioThreeMeshBvhVec3;
              geometryEpoch: number;
            }>;
        let containment: StudioThreeMeshBvhCandidateArtifact["containment"];
        if (input.kind === "sphere") {
          const centerWorld = finiteVec3(input.centerWorld, "centerWorld");
          if (
            !Number.isFinite(input.radiusWorld)
            || input.radiusWorld < 0
            || input.radiusWorld
              > STUDIO_THREE_MESH_BVH_BUDGETS.maxCoordinateMagnitude
          ) {
            invalid("radiusWorld must be a bounded non-negative value.");
          }
          localShape = {
            kind: "sphere",
            center: transformPoint(options.worldToLocal, centerWorld),
            radius: conservativeSphereRadius(
              options.worldToLocal,
              input.radiusWorld,
            ),
          };
          queryPayload = {
            kind: "sphere",
            centerWorld,
            radiusWorld: input.radiusWorld,
            geometryEpoch,
          };
          containment = "conservative-world-shape";
        } else {
          const minWorld = finiteVec3(input.minWorld, "minWorld");
          const maxWorld = finiteVec3(input.maxWorld, "maxWorld");
          if (minWorld.some((value, index) => value > maxWorld[index]!)) {
            invalid("Box minWorld must not exceed maxWorld.");
          }
          const localBox = conservativeLocalBox(
            minWorld,
            maxWorld,
            options.worldToLocal,
          );
          localShape = { kind: "box", ...localBox };
          queryPayload = {
            kind: "box",
            minWorld,
            maxWorld,
            geometryEpoch,
          };
          containment = "conservative-world-shape";
        }
        const runtimeResult = runtime.shapeCandidates(boundsTree, localShape, {
          maxTriangleTests:
            STUDIO_THREE_MESH_BVH_BUDGETS.maxTriangleTestsPerQuery,
          maxCandidates:
            STUDIO_THREE_MESH_BVH_BUDGETS.maxCandidatesPerQuery,
        });
        return {
          kind: "studio-three-mesh-bvh-query-receipt",
          revision: STUDIO_THREE_MESH_BVH_PROVIDER_REVISION,
          providerId: "three-mesh-bvh",
          query: input.kind === "sphere"
            ? "sphere-candidates"
            : "box-candidates",
          geometryEpoch,
          queryHash: digestText(JSON.stringify(queryPayload)),
          result: candidateArtifact(
            runtimeResult,
            geometryStats.triangleCount,
            geometryEpoch,
            containment,
            options,
          ),
        };
      });
    },

    lassoCandidates(input) {
      return withOperation(input.signal, async () => {
        ensureEpoch(input.expectedGeometryEpoch);
        await buildInternal(input.signal);
        if (!runtime || !boundsTree || !geometryStats) {
          throw new StudioThreeMeshBvhProviderError(
            "runtime-failed",
            "Three mesh BVH was not initialized.",
          );
        }
        if (
          !Array.isArray(input.polygonNdc)
          || input.polygonNdc.length < 3
          || input.polygonNdc.length
            > STUDIO_THREE_MESH_BVH_BUDGETS.maxLassoPoints
        ) {
          invalid("polygonNdc must contain a bounded polygon.");
        }
        const polygonNdc = input.polygonNdc.map((point, index) => {
          if (
            !Array.isArray(point)
            || point.length !== 2
            || point.some(
              (component) =>
                !Number.isFinite(component)
                || Math.abs(component) > 2,
            )
          ) {
            invalid(`polygonNdc[${index}] is invalid.`);
          }
          return [point[0], point[1]] as const;
        });
        const worldToClip = finiteMatrix(
          input.worldToClip,
          "worldToClip",
          false,
        );
        const selection = input.selection ?? "any-vertex";
        if (selection !== "centroid" && selection !== "any-vertex") {
          invalid("Unsupported lasso selection mode.");
        }
        const runtimeResult = runtime.lassoCandidates(boundsTree, {
          localToWorld: options.localToWorld,
          worldToClip,
          polygonNdc,
          selection,
          maxTriangleTests:
            STUDIO_THREE_MESH_BVH_BUDGETS.maxTriangleTestsPerQuery,
          maxCandidates:
            STUDIO_THREE_MESH_BVH_BUDGETS.maxCandidatesPerQuery,
        });
        return {
          kind: "studio-three-mesh-bvh-query-receipt",
          revision: STUDIO_THREE_MESH_BVH_PROVIDER_REVISION,
          providerId: "three-mesh-bvh",
          query: "lasso-candidates",
          geometryEpoch,
          queryHash: digestText(JSON.stringify({
            polygonNdc,
            worldToClip,
            selection,
            geometryEpoch,
          })),
          result: candidateArtifact(
            runtimeResult,
            geometryStats.triangleCount,
            geometryEpoch,
            "projected-ndc",
            options,
          ),
        };
      });
    },

    refit(input) {
      return withOperation(input.signal, async () => {
        if (!options.allowRefit) invalid("BVH refit is disabled.");
        ensureEpoch(input.expectedGeometryEpoch);
        if (
          !Number.isSafeInteger(input.nextGeometryEpoch)
          || input.nextGeometryEpoch <= geometryEpoch
        ) {
          invalid("nextGeometryEpoch must increase monotonically.");
        }
        await buildInternal(input.signal);
        if (!runtime || !boundsTree) {
          throw new StudioThreeMeshBvhProviderError(
            "runtime-failed",
            "Three mesh BVH was not initialized.",
          );
        }
        const previousGeometryEpoch = geometryEpoch;
        runtime.refit(boundsTree, input.signal);
        aborted(input.signal);
        geometryEpoch = input.nextGeometryEpoch;
        if (buildReceipt) {
          const { receiptHash: _previousHash, ...previousReceipt } = buildReceipt;
          const nextReceipt = { ...previousReceipt, geometryEpoch };
          buildReceipt = {
            ...nextReceipt,
            receiptHash: digestText(JSON.stringify(nextReceipt)),
          };
        }
        return {
          kind: "studio-three-mesh-bvh-refit-receipt",
          revision: STUDIO_THREE_MESH_BVH_PROVIDER_REVISION,
          providerId: "three-mesh-bvh",
          previousGeometryEpoch,
          geometryEpoch,
        };
      });
    },

    snapshot() {
      return {
        state,
        built: boundsTree !== null,
        runtimeLoaded: runtime !== null,
        geometryEpoch,
        activeOperations,
      };
    },

    destroy() {
      if (destroyPromise) return destroyPromise;
      state = "destroying";
      destroyPromise = (async () => {
        if (activeOperations > 0) {
          await new Promise<void>((resolve) => {
            resolveIdle = resolve;
          });
        }
        if (runtime && boundsTree) {
          runtime.disposeBoundsTree(
            boundsTree,
            options.geometry,
            options.attachBoundsTreeToGeometry,
          );
        }
        boundsTree = null;
        if (runtime && options.geometryOwnership === "provider-owned") {
          runtime.disposeGeometry(options.geometry);
        }
        if (runtime) await runtime.destroy();
        runtime = null;
        runtimePromise = null;
        buildPromise = null;
        buildReceipt = null;
        geometryStats = null;
        state = "destroyed";
      })();
      return destroyPromise;
    },
  };
  return provider;
}

type ThreeNamespace = typeof import("three");
type ThreeMeshBvhModule = typeof import("three-mesh-bvh");
type ThreeBufferGeometry = import("three").BufferGeometry;
type MeshBvh = InstanceType<ThreeMeshBvhModule["MeshBVH"]>;

function createThreeMeshBvhRuntime(
  three: ThreeNamespace,
  module: ThreeMeshBvhModule,
): StudioThreeMeshBvhRuntime {
  const strategyMap = {
    center: module.CENTER,
    average: module.AVERAGE,
    sah: module.SAH,
  } as const;
  const vector = (value: StudioThreeMeshBvhVec3) =>
    new three.Vector3(value[0], value[1], value[2]);
  const tuple = (value: import("three").Vector3): StudioThreeMeshBvhVec3 =>
    [value.x, value.y, value.z];

  return {
    version: "three-mesh-bvh-0.9.13",
    inspectGeometry(geometryValue) {
      const geometry = geometryValue as ThreeBufferGeometry;
      const position = geometry.getAttribute("position");
      if (!position || position.itemSize < 3) {
        return {
          vertexCount: 0,
          triangleCount: 0,
          indexed: false,
          finitePositions: false,
        };
      }
      let finitePositions = true;
      for (let index = 0; index < position.count; index += 1) {
        if (
          !Number.isFinite(position.getX(index))
          || !Number.isFinite(position.getY(index))
          || !Number.isFinite(position.getZ(index))
        ) {
          finitePositions = false;
          break;
        }
      }
      const primitiveCount = geometry.index?.count ?? position.count;
      return {
        vertexCount: position.count,
        triangleCount: primitiveCount / 3,
        indexed: geometry.index !== null,
        finitePositions,
      };
    },
    build(geometryValue, options) {
      aborted(options.signal);
      const geometry = geometryValue as ThreeBufferGeometry & {
        boundsTree?: MeshBvh;
        disposeBoundsTree?: () => void;
      };
      if (options.attachToGeometry && geometry.boundsTree) {
        throw new Error("Geometry already owns a bounds tree.");
      }
      const boundsTree = new module.MeshBVH(geometry, {
        strategy: strategyMap[options.strategy],
        maxDepth: options.maxDepth,
        targetLeafSize: options.targetLeafSize,
        indirect: true,
        setBoundingBox: false,
        verbose: false,
        onProgress() {
          aborted(options.signal);
        },
      });
      if (options.attachToGeometry) geometry.boundsTree = boundsTree;
      return boundsTree;
    },
    raycastFirst(boundsTreeValue, ray) {
      const hit = (boundsTreeValue as MeshBvh).raycastFirst(
        new three.Ray(vector(ray.origin), vector(ray.direction)),
        three.DoubleSide,
        ray.near,
        ray.far,
      );
      if (!hit) return null;
      return {
        point: tuple(hit.point),
        normal: hit.face ? tuple(hit.face.normal) : null,
        distance: hit.distance,
        faceIndex: hit.faceIndex ?? -1,
      };
    },
    closestPoint(boundsTreeValue, point, maxDistance) {
      const target: import("three-mesh-bvh").HitPointInfo = {
        point: new three.Vector3(),
        distance: 0,
        faceIndex: -1,
      };
      const hit = (boundsTreeValue as MeshBvh).closestPointToPoint(
        vector(point),
        target,
        0,
        maxDistance,
      );
      if (!hit) return null;
      return {
        point: tuple(hit.point),
        normal: null,
        distance: hit.distance,
        faceIndex: hit.faceIndex,
      };
    },
    shapeCandidates(boundsTreeValue, shape, limits) {
      const candidates: number[] = [];
      let triangleTests = 0;
      let truncated = false;
      const closest = new three.Vector3();
      const sphere = shape.kind === "sphere"
        ? new three.Sphere(vector(shape.center), shape.radius)
        : null;
      const queryBox = shape.kind === "box"
        ? new three.Box3(vector(shape.min), vector(shape.max))
        : null;
      (boundsTreeValue as MeshBvh).shapecast({
        intersectsBounds(box) {
          return sphere
            ? box.intersectsSphere(sphere)
            : box.intersectsBox(queryBox!);
        },
        intersectsTriangle(triangle, triangleIndex) {
          triangleTests += 1;
          if (triangleTests > limits.maxTriangleTests) {
            truncated = true;
            return true;
          }
          const intersects = sphere
            ? triangle.closestPointToPoint(sphere.center, closest)
                .distanceToSquared(sphere.center) <= sphere.radius ** 2
            : queryBox!.intersectsTriangle(triangle);
          if (intersects) candidates.push(triangleIndex);
          if (candidates.length >= limits.maxCandidates) {
            truncated = true;
            return true;
          }
          return false;
        },
      });
      return {
        triangleIndices: candidates,
        triangleTests: Math.min(triangleTests, limits.maxTriangleTests),
        truncated,
      };
    },
    lassoCandidates(boundsTreeValue, input) {
      const candidates: number[] = [];
      let triangleTests = 0;
      let truncated = false;
      const localToWorld = new three.Matrix4().fromArray(input.localToWorld);
      const worldToClip = new three.Matrix4().fromArray(input.worldToClip);
      const project = (point: import("three").Vector3) =>
        point.clone().applyMatrix4(localToWorld).applyMatrix4(worldToClip);
      const inside = (point: import("three").Vector3): boolean => {
        if (point.z < -1 || point.z > 1) return false;
        let selected = false;
        for (
          let current = 0, previous = input.polygonNdc.length - 1;
          current < input.polygonNdc.length;
          previous = current, current += 1
        ) {
          const a = input.polygonNdc[current]!;
          const b = input.polygonNdc[previous]!;
          if (
            (a[1] > point.y) !== (b[1] > point.y)
            && point.x
              < (b[0] - a[0]) * (point.y - a[1]) / (b[1] - a[1]) + a[0]
          ) {
            selected = !selected;
          }
        }
        return selected;
      };
      (boundsTreeValue as MeshBvh).shapecast({
        intersectsBounds: () => true,
        intersectsTriangle(triangle, triangleIndex) {
          triangleTests += 1;
          if (triangleTests > input.maxTriangleTests) {
            truncated = true;
            return true;
          }
          const selected = input.selection === "centroid"
            ? inside(
                project(
                  triangle.a.clone()
                    .add(triangle.b)
                    .add(triangle.c)
                    .multiplyScalar(1 / 3),
                ),
              )
            : [triangle.a, triangle.b, triangle.c]
                .some((point) => inside(project(point)));
          if (selected) candidates.push(triangleIndex);
          if (candidates.length >= input.maxCandidates) {
            truncated = true;
            return true;
          }
          return false;
        },
      });
      return {
        triangleIndices: candidates,
        triangleTests: Math.min(triangleTests, input.maxTriangleTests),
        truncated,
      };
    },
    refit(boundsTreeValue, signal) {
      aborted(signal);
      (boundsTreeValue as MeshBvh).refit();
      aborted(signal);
    },
    disposeBoundsTree(boundsTreeValue, geometryValue, attachedToGeometry) {
      const boundsTree = boundsTreeValue as MeshBvh;
      const geometry = geometryValue as ThreeBufferGeometry & {
        boundsTree?: MeshBvh | null;
        disposeBoundsTree?: () => void;
      };
      if (
        attachedToGeometry
        && geometry.boundsTree === boundsTree
        && typeof geometry.disposeBoundsTree === "function"
      ) {
        geometry.disposeBoundsTree();
        return;
      }
      if (attachedToGeometry && geometry.boundsTree === boundsTree) {
        delete geometry.boundsTree;
      }
    },
    disposeGeometry(geometry) {
      (geometry as ThreeBufferGeometry).dispose();
    },
    destroy() {
      // Every tree is explicitly disposed; the imported module is stateless.
    },
  };
}

/** Loads the acceleration package only when the first operation builds a BVH. */
export async function loadStudioThreeMeshBvhRuntime(
  three: ThreeNamespace,
): Promise<StudioThreeMeshBvhRuntime> {
  const module = await import("three-mesh-bvh");
  return createThreeMeshBvhRuntime(three, module);
}
