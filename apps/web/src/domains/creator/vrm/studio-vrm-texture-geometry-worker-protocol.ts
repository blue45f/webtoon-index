/**
 * Transfer-only protocol and deterministic UV-topology builder for VRM surface painting.
 *
 * The main realm snapshots packed position/UV/index arrays before transfer. The worker returns only
 * compact typed arrays needed by the paint runtime; Three.js objects, source buffers, functions,
 * and unbounded strings never cross the realm boundary.
 */

export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION = 1 as const;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TRIANGLES = 500_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES = 1_500_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_EDGES = 1_500_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES = 96_000_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_OUTPUT_BYTES = 40_000_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_ESTIMATED_WORKING_BYTES = 384_000_000;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_DEFAULT_UV_EPSILON = 1e-7;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MIN_EPSILON = 1e-12;
export const STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_EPSILON = 1_000_000;

const MIN_POSITION_EPSILON = 1e-9;
const RELATIVE_POSITION_EPSILON = 1e-8;
const UV_ATTRIBUTE_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const RESPONSE_ERROR_CODES = new Set<StudioVrmTextureGeometryWorkerFailureCode>([
  "edge-budget-exceeded",
  "input-budget-exceeded",
  "invalid-input",
  "output-budget-exceeded",
  "triangle-budget-exceeded",
  "vertex-budget-exceeded",
  "working-memory-budget-exceeded",
]);

export type StudioVrmTextureGeometryWorkerFloatArray =
  | Float32Array<ArrayBuffer>
  | Float64Array<ArrayBuffer>;

export interface StudioVrmTextureGeometryWorkerRequest {
  readonly version: typeof STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION;
  readonly kind: "build-topology";
  readonly requestId: number;
  readonly generationId: number;
  readonly uvAttribute: string;
  /** null selects the same bounds-relative epsilon as the synchronous geometry index. */
  readonly positionEpsilon: number | null;
  readonly uvEpsilon: number;
  readonly maxTriangles: number;
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly inputByteLength: number;
  /** Packed XYZ values, exactly vertexCount * 3. */
  readonly positions: StudioVrmTextureGeometryWorkerFloatArray;
  /** Packed UV values, exactly vertexCount * 2. */
  readonly uvs: StudioVrmTextureGeometryWorkerFloatArray;
  /** Exactly triangleCount * 3, or null for sequential non-indexed triangles. */
  readonly indices: Uint32Array<ArrayBuffer> | null;
}

export interface StudioVrmTextureGeometryWorkerTopology {
  readonly triangleCount: number;
  readonly islandCount: number;
  readonly uvAttribute: string;
  readonly byteLength: number;
  /** -1 marks a triangle whose vertex/index/position/UV data was invalid. */
  readonly triangleIslandIds: Int32Array<ArrayBuffer>;
  /** Smallest face index of each contiguous, deterministically numbered island. */
  readonly islandAnchors: Uint32Array<ArrayBuffer>;
  /** Twice the local UV area for each triangle. */
  readonly uvDoubleAreas: Float64Array<ArrayBuffer>;
  /** Two local XYZ edge vectors per triangle, six numbers total. */
  readonly localEdges: Float64Array<ArrayBuffer>;
}

export interface StudioVrmTextureGeometryWorkerResultResponse {
  readonly version: typeof STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION;
  readonly kind: "result";
  readonly requestId: number;
  readonly generationId: number;
  readonly topology: StudioVrmTextureGeometryWorkerTopology;
}

export type StudioVrmTextureGeometryWorkerFailureCode =
  | "edge-budget-exceeded"
  | "input-budget-exceeded"
  | "invalid-input"
  | "output-budget-exceeded"
  | "triangle-budget-exceeded"
  | "vertex-budget-exceeded"
  | "working-memory-budget-exceeded";

export interface StudioVrmTextureGeometryWorkerErrorResponse {
  readonly version: typeof STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION;
  readonly kind: "error";
  readonly requestId: number;
  readonly generationId: number;
  readonly code: StudioVrmTextureGeometryWorkerFailureCode;
}

export type StudioVrmTextureGeometryWorkerResponse =
  | StudioVrmTextureGeometryWorkerResultResponse
  | StudioVrmTextureGeometryWorkerErrorResponse;

export class StudioVrmTextureGeometryWorkerComputationError extends Error {
  constructor(readonly code: StudioVrmTextureGeometryWorkerFailureCode) {
    super(code);
    this.name = "StudioVrmTextureGeometryWorkerComputationError";
  }
}

function fail(code: StudioVrmTextureGeometryWorkerFailureCode): never {
  throw new StudioVrmTextureGeometryWorkerComputationError(code);
}

function compareStrings(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactDataKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]) &&
    actual.every((key) => {
      const descriptor = descriptors[key];
      return descriptor !== undefined && "value" in descriptor;
    });
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSafeUvAttribute(value: unknown): value is string {
  return typeof value === "string" && UV_ATTRIBUTE_PATTERN.test(value);
}

function isValidEpsilon(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MIN_EPSILON &&
    value <= STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_EPSILON;
}

function isOwnedFloatArray(value: unknown): value is StudioVrmTextureGeometryWorkerFloatArray {
  return (
    value instanceof Float32Array || value instanceof Float64Array
  ) &&
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength;
}

function isOwnedUint32Array(value: unknown): value is Uint32Array<ArrayBuffer> {
  return value instanceof Uint32Array &&
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength;
}

function isOwnedInt32Array(value: unknown): value is Int32Array<ArrayBuffer> {
  return value instanceof Int32Array &&
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength;
}

function isOwnedFloat64Array(value: unknown): value is Float64Array<ArrayBuffer> {
  return value instanceof Float64Array &&
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength;
}

function checkedProduct(left: number, right: number): number {
  if (
    !Number.isSafeInteger(left) ||
    left < 0 ||
    !Number.isSafeInteger(right) ||
    right < 0 ||
    (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left))
  ) fail("working-memory-budget-exceeded");
  return left * right;
}

function checkedSum(left: number, right: number, maximum: number): number {
  if (!Number.isSafeInteger(right) || right < 0 || left > maximum - right) {
    fail("working-memory-budget-exceeded");
  }
  return left + right;
}

function requestMeasuredInputBytes(
  positions: StudioVrmTextureGeometryWorkerFloatArray,
  uvs: StudioVrmTextureGeometryWorkerFloatArray,
  indices: Uint32Array<ArrayBuffer> | null,
): number {
  let total = checkedSum(0, positions.byteLength, STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES);
  total = checkedSum(total, uvs.byteLength, STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES);
  if (indices) {
    total = checkedSum(total, indices.byteLength, STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES);
  }
  return total;
}

/**
 * Exact hostile-message guard. SharedArrayBuffer and subviews are rejected so transfers cannot
 * detach unrelated caller storage or smuggle unbudgeted bytes.
 */
export function isStudioVrmTextureGeometryWorkerRequest(
  value: unknown,
): value is StudioVrmTextureGeometryWorkerRequest {
  if (!hasExactDataKeys(value, [
    "version",
    "kind",
    "requestId",
    "generationId",
    "uvAttribute",
    "positionEpsilon",
    "uvEpsilon",
    "maxTriangles",
    "vertexCount",
    "triangleCount",
    "inputByteLength",
    "positions",
    "uvs",
    "indices",
  ])) return false;
  if (
    value.version !== STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION ||
    value.kind !== "build-topology" ||
    !isPositiveSafeInteger(value.requestId) ||
    !isPositiveSafeInteger(value.generationId) ||
    !isSafeUvAttribute(value.uvAttribute) ||
    !(value.positionEpsilon === null || isValidEpsilon(value.positionEpsilon)) ||
    !isValidEpsilon(value.uvEpsilon) ||
    !isPositiveSafeInteger(value.maxTriangles) ||
    value.maxTriangles > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TRIANGLES ||
    !isPositiveSafeInteger(value.vertexCount) ||
    value.vertexCount > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES ||
    !isPositiveSafeInteger(value.triangleCount) ||
    value.triangleCount > value.maxTriangles ||
    !isPositiveSafeInteger(value.inputByteLength) ||
    value.inputByteLength > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES ||
    !isOwnedFloatArray(value.positions) ||
    !isOwnedFloatArray(value.uvs) ||
    value.positions.length !== value.vertexCount * 3 ||
    value.uvs.length !== value.vertexCount * 2 ||
    !(value.indices === null || isOwnedUint32Array(value.indices)) ||
    (value.indices === null
      ? value.vertexCount !== value.triangleCount * 3
      : value.indices.length !== value.triangleCount * 3)
  ) return false;
  try {
    return requestMeasuredInputBytes(value.positions, value.uvs, value.indices)
      === value.inputByteLength;
  } catch {
    return false;
  }
}

export function studioVrmTextureGeometryWorkerRequestTransfers(
  request: StudioVrmTextureGeometryWorkerRequest,
): Transferable[] {
  const buffers = [
    request.positions.buffer,
    request.uvs.buffer,
    request.indices?.buffer,
  ].filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
  return [...new Set(buffers)];
}

function expectedTopologyBytes(
  triangleCount: number,
  islandCount: number,
): number {
  let total = checkedProduct(triangleCount, Int32Array.BYTES_PER_ELEMENT);
  total = checkedSum(
    total,
    checkedProduct(islandCount, Uint32Array.BYTES_PER_ELEMENT),
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_OUTPUT_BYTES,
  );
  total = checkedSum(
    total,
    checkedProduct(triangleCount, Float64Array.BYTES_PER_ELEMENT),
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_OUTPUT_BYTES,
  );
  total = checkedSum(
    total,
    checkedProduct(triangleCount * 6, Float64Array.BYTES_PER_ELEMENT),
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_OUTPUT_BYTES,
  );
  return total;
}

export function isStudioVrmTextureGeometryWorkerTopology(
  value: unknown,
): value is StudioVrmTextureGeometryWorkerTopology {
  if (!hasExactDataKeys(value, [
    "triangleCount",
    "islandCount",
    "uvAttribute",
    "byteLength",
    "triangleIslandIds",
    "islandAnchors",
    "uvDoubleAreas",
    "localEdges",
  ])) return false;
  if (
    !isPositiveSafeInteger(value.triangleCount) ||
    value.triangleCount > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TRIANGLES ||
    !isNonNegativeSafeInteger(value.islandCount) ||
    value.islandCount > value.triangleCount ||
    !isSafeUvAttribute(value.uvAttribute) ||
    !isPositiveSafeInteger(value.byteLength) ||
    value.byteLength > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_OUTPUT_BYTES ||
    !isOwnedInt32Array(value.triangleIslandIds) ||
    value.triangleIslandIds.length !== value.triangleCount ||
    !isOwnedUint32Array(value.islandAnchors) ||
    value.islandAnchors.length !== value.islandCount ||
    !isOwnedFloat64Array(value.uvDoubleAreas) ||
    value.uvDoubleAreas.length !== value.triangleCount ||
    !isOwnedFloat64Array(value.localEdges) ||
    value.localEdges.length !== value.triangleCount * 6
  ) return false;
  try {
    return expectedTopologyBytes(value.triangleCount, value.islandCount) === value.byteLength;
  } catch {
    return false;
  }
}

/**
 * Allocation-free semantic validation in the receiving realm. This rejects hostile but
 * shape-correct Worker output before the runtime caches it.
 */
export function hasValidStudioVrmTextureGeometryWorkerTopologyNumbers(
  topology: StudioVrmTextureGeometryWorkerTopology,
): boolean {
  let nextIslandId = 0;
  for (let faceIndex = 0; faceIndex < topology.triangleCount; faceIndex += 1) {
    const islandId = topology.triangleIslandIds[faceIndex];
    const uvArea = topology.uvDoubleAreas[faceIndex];
    if (
      islandId === undefined ||
      islandId < -1 ||
      islandId >= topology.islandCount ||
      uvArea === undefined ||
      !Number.isFinite(uvArea) ||
      uvArea < 0
    ) return false;
    if (islandId === nextIslandId) {
      if (topology.islandAnchors[islandId] !== faceIndex) return false;
      nextIslandId += 1;
    } else if (islandId >= nextIslandId) {
      return false;
    }
    const edgeOffset = faceIndex * 6;
    for (let component = 0; component < 6; component += 1) {
      if (!Number.isFinite(topology.localEdges[edgeOffset + component])) return false;
    }
  }
  return nextIslandId === topology.islandCount;
}

export function isStudioVrmTextureGeometryWorkerResponse(
  value: unknown,
): value is StudioVrmTextureGeometryWorkerResponse {
  if (!isPlainRecord(value)) return false;
  const identityIsValid =
    value.version === STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_PROTOCOL_VERSION &&
    isPositiveSafeInteger(value.requestId) &&
    isPositiveSafeInteger(value.generationId);
  if (!identityIsValid) return false;
  if (value.kind === "error") {
    return hasExactDataKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "code",
    ]) && RESPONSE_ERROR_CODES.has(value.code as StudioVrmTextureGeometryWorkerFailureCode);
  }
  return value.kind === "result" &&
    hasExactDataKeys(value, [
      "version",
      "kind",
      "requestId",
      "generationId",
      "topology",
    ]) &&
    isStudioVrmTextureGeometryWorkerTopology(value.topology);
}

export function studioVrmTextureGeometryWorkerResponseTransfers(
  response: StudioVrmTextureGeometryWorkerResponse,
): Transferable[] {
  if (response.kind !== "result") return [];
  return [
    response.topology.triangleIslandIds.buffer,
    response.topology.islandAnchors.buffer,
    response.topology.uvDoubleAreas.buffer,
    response.topology.localEdges.buffer,
  ];
}

function normalizedPositionEpsilon(
  positions: StudioVrmTextureGeometryWorkerFloatArray,
  configured: number | null,
): number {
  if (configured !== null) return configured;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset];
    const y = positions[offset + 1];
    const z = positions[offset + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (!Number.isFinite(diagonal) || diagonal <= 0) return MIN_POSITION_EPSILON;
  return Math.max(MIN_POSITION_EPSILON, diagonal * RELATIVE_POSITION_EPSILON);
}

function quantized(value: number, epsilon: number): string {
  const rounded = Math.round(value / epsilon);
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function vertexTopologyKey(
  positions: StudioVrmTextureGeometryWorkerFloatArray,
  uvs: StudioVrmTextureGeometryWorkerFloatArray,
  vertexIndex: number,
  positionEpsilon: number,
  uvEpsilon: number,
): string | null {
  const positionOffset = vertexIndex * 3;
  const uvOffset = vertexIndex * 2;
  const x = positions[positionOffset];
  const y = positions[positionOffset + 1];
  const z = positions[positionOffset + 2];
  const u = uvs[uvOffset];
  const v = uvs[uvOffset + 1];
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(u) ||
    !Number.isFinite(v)
  ) return null;
  return [
    quantized(x, positionEpsilon),
    quantized(y, positionEpsilon),
    quantized(z, positionEpsilon),
    quantized(u, uvEpsilon),
    quantized(v, uvEpsilon),
  ].join(",");
}

function edgeTopologyKey(first: string, second: string): string | null {
  if (first === second) return null;
  return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function findRoot(parents: Int32Array, value: number): number {
  let root = value;
  while (parents[root] !== root) root = parents[root]!;
  let current = value;
  while (parents[current] !== current) {
    const next = parents[current]!;
    parents[current] = root;
    current = next;
  }
  return root;
}

function unionByMinimumRoot(parents: Int32Array, first: number, second: number): void {
  const firstRoot = findRoot(parents, first);
  const secondRoot = findRoot(parents, second);
  if (firstRoot === secondRoot) return;
  parents[Math.max(firstRoot, secondRoot)] = Math.min(firstRoot, secondRoot);
}

function estimatedWorkingBytes(request: StudioVrmTextureGeometryWorkerRequest): number {
  const edgeCount = checkedProduct(request.triangleCount, 3);
  let total = request.inputByteLength;
  total = checkedSum(
    total,
    expectedTopologyBytes(request.triangleCount, request.triangleCount),
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_ESTIMATED_WORKING_BYTES,
  );
  // Conservative JS Map/string/union-find accounting. It intentionally rejects pathological
  // non-indexed meshes before allocating millions of topology strings.
  total = checkedSum(
    total,
    checkedProduct(request.vertexCount, 72),
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_ESTIMATED_WORKING_BYTES,
  );
  total = checkedSum(
    total,
    checkedProduct(edgeCount, 88),
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_ESTIMATED_WORKING_BYTES,
  );
  total = checkedSum(
    total,
    checkedProduct(request.triangleCount, 12),
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_ESTIMATED_WORKING_BYTES,
  );
  return total;
}

/**
 * Pure deterministic implementation shared by the Worker and the tiny bounded synchronous
 * fallback. The input must first pass the strict protocol guard.
 */
export function computeStudioVrmTextureGeometryWorkerTopology(
  request: StudioVrmTextureGeometryWorkerRequest,
): StudioVrmTextureGeometryWorkerTopology {
  if (!isStudioVrmTextureGeometryWorkerRequest(request)) fail("invalid-input");
  if (request.vertexCount > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES) {
    fail("vertex-budget-exceeded");
  }
  if (
    request.triangleCount > request.maxTriangles ||
    request.triangleCount > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_TRIANGLES
  ) fail("triangle-budget-exceeded");
  if (request.triangleCount * 3 > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_EDGES) {
    fail("edge-budget-exceeded");
  }
  if (request.inputByteLength > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_INPUT_BYTES) {
    fail("input-budget-exceeded");
  }
  if (estimatedWorkingBytes(request) >
    STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_ESTIMATED_WORKING_BYTES) {
    fail("working-memory-budget-exceeded");
  }

  const positionEpsilon = normalizedPositionEpsilon(
    request.positions,
    request.positionEpsilon,
  );
  const parents = new Int32Array(request.triangleCount);
  const validTriangles = new Uint8Array(request.triangleCount);
  const uvDoubleAreas = new Float64Array(request.triangleCount);
  const localEdges = new Float64Array(request.triangleCount * 6);
  const edgeOwners = new Map<string, number>();

  for (let faceIndex = 0; faceIndex < request.triangleCount; faceIndex += 1) {
    parents[faceIndex] = faceIndex;
    const flatOffset = faceIndex * 3;
    const aIndex = request.indices?.[flatOffset] ?? flatOffset;
    const bIndex = request.indices?.[flatOffset + 1] ?? flatOffset + 1;
    const cIndex = request.indices?.[flatOffset + 2] ?? flatOffset + 2;
    if (
      aIndex >= request.vertexCount ||
      bIndex >= request.vertexCount ||
      cIndex >= request.vertexCount
    ) continue;
    const aKey = vertexTopologyKey(
      request.positions,
      request.uvs,
      aIndex,
      positionEpsilon,
      request.uvEpsilon,
    );
    const bKey = vertexTopologyKey(
      request.positions,
      request.uvs,
      bIndex,
      positionEpsilon,
      request.uvEpsilon,
    );
    const cKey = vertexTopologyKey(
      request.positions,
      request.uvs,
      cIndex,
      positionEpsilon,
      request.uvEpsilon,
    );
    if (!aKey || !bKey || !cKey) continue;

    const aPositionOffset = aIndex * 3;
    const bPositionOffset = bIndex * 3;
    const cPositionOffset = cIndex * 3;
    const aUvOffset = aIndex * 2;
    const bUvOffset = bIndex * 2;
    const cUvOffset = cIndex * 2;
    validTriangles[faceIndex] = 1;
    const edgeOffset = faceIndex * 6;
    localEdges[edgeOffset] =
      request.positions[bPositionOffset]! - request.positions[aPositionOffset]!;
    localEdges[edgeOffset + 1] =
      request.positions[bPositionOffset + 1]! - request.positions[aPositionOffset + 1]!;
    localEdges[edgeOffset + 2] =
      request.positions[bPositionOffset + 2]! - request.positions[aPositionOffset + 2]!;
    localEdges[edgeOffset + 3] =
      request.positions[cPositionOffset]! - request.positions[aPositionOffset]!;
    localEdges[edgeOffset + 4] =
      request.positions[cPositionOffset + 1]! - request.positions[aPositionOffset + 1]!;
    localEdges[edgeOffset + 5] =
      request.positions[cPositionOffset + 2]! - request.positions[aPositionOffset + 2]!;
    uvDoubleAreas[faceIndex] = Math.abs(
      (request.uvs[bUvOffset]! - request.uvs[aUvOffset]!) *
        (request.uvs[cUvOffset + 1]! - request.uvs[aUvOffset + 1]!) -
      (request.uvs[cUvOffset]! - request.uvs[aUvOffset]!) *
        (request.uvs[bUvOffset + 1]! - request.uvs[aUvOffset + 1]!),
    );

    for (const [first, second] of [
      [aKey, bKey],
      [bKey, cKey],
      [cKey, aKey],
    ] as const) {
      const edgeKey = edgeTopologyKey(first, second);
      if (!edgeKey) continue;
      const owner = edgeOwners.get(edgeKey);
      if (owner === undefined) {
        if (edgeOwners.size >= STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_EDGES) {
          fail("edge-budget-exceeded");
        }
        edgeOwners.set(edgeKey, faceIndex);
      } else {
        unionByMinimumRoot(parents, owner, faceIndex);
      }
    }
  }

  const triangleIslandIds = new Int32Array(request.triangleCount);
  triangleIslandIds.fill(-1);
  const rootToIsland = new Map<number, number>();
  const islandAnchors: number[] = [];
  for (let faceIndex = 0; faceIndex < request.triangleCount; faceIndex += 1) {
    if (validTriangles[faceIndex] === 0) continue;
    const root = findRoot(parents, faceIndex);
    let islandId = rootToIsland.get(root);
    if (islandId === undefined) {
      islandId = islandAnchors.length;
      rootToIsland.set(root, islandId);
      islandAnchors.push(faceIndex);
    }
    triangleIslandIds[faceIndex] = islandId;
  }

  const anchors = Uint32Array.from(islandAnchors);
  const byteLength = expectedTopologyBytes(request.triangleCount, anchors.length);
  if (byteLength > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_OUTPUT_BYTES) {
    fail("output-budget-exceeded");
  }
  const topology = Object.freeze({
    triangleCount: request.triangleCount,
    islandCount: anchors.length,
    uvAttribute: request.uvAttribute,
    byteLength,
    triangleIslandIds,
    islandAnchors: anchors,
    uvDoubleAreas,
    localEdges,
  });
  if (
    !isStudioVrmTextureGeometryWorkerTopology(topology) ||
    !hasValidStudioVrmTextureGeometryWorkerTopologyNumbers(topology)
  ) fail("invalid-input");
  return topology;
}
