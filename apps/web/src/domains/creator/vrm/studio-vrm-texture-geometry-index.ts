/**
 * VRM/일반 메시 텍스처 페인팅용 UV 아일랜드·텍셀 밀도 인덱스.
 *
 * 메시 전체를 훑는 작업은 `getStudioVrmTextureGeometryIndex` 최초 호출 때 한 번만 수행한다.
 * 이후 Raycaster의 `faceIndex` 조회는 배열 인덱싱과 삼각형 하나의 상수 시간 수학만 사용한다.
 * BufferGeometry의 attribute/index `version`이 바뀌면 캐시를 자동 재작성하며, 버퍼를 직접
 * 변경하면서 `needsUpdate`를 표시하지 않는 특수 경로는 명시적 invalidation API를 쓴다.
 *
 * UV 아일랜드는 "같은 3D 모서리 + 같은 UV 모서리"를 공유하는 삼각형의 연결 성분이다.
 * 위치까지 키에 포함하므로 아틀라스에서 우연히 겹친 별도 표면은 합쳐지지 않고, 인덱스가
 * 하드 노멀 때문에 분리됐어도 위치와 UV가 같으면 같은 아일랜드로 복원된다.
 */

import {
  StudioVrmTextureGeometryWorkerClientError,
  buildStudioVrmTextureGeometryTopologyInWorker,
  type StudioVrmTextureGeometryFloatSource,
  type StudioVrmTextureGeometryExecutionBackend,
  type StudioVrmTextureGeometryIndexSource,
  type StudioVrmTextureGeometryWorkerBuildOptions,
  type StudioVrmTextureGeometryWorkerFactory,
  type StudioVrmTextureGeometryWorkerInput,
} from "./studio-vrm-texture-geometry-worker-client";
import {
  STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES,
  hasValidStudioVrmTextureGeometryWorkerTopologyNumbers,
  isStudioVrmTextureGeometryWorkerTopology,
  type StudioVrmTextureGeometryWorkerTopology,
} from "./studio-vrm-texture-geometry-worker-protocol";
import { isStudioVrmTextureSize, type StudioVrmTextureSize } from "./studio-vrm-texture-uv";

export const STUDIO_VRM_TEXTURE_GEOMETRY_MAX_TRIANGLES = 500_000;

const DEFAULT_UV_EPSILON = 1e-7;
const MIN_POSITION_EPSILON = 1e-9;
const RELATIVE_POSITION_EPSILON = 1e-8;

interface StudioVrmGeometryAttributeLike {
  readonly count: number;
  readonly itemSize: number;
  readonly version?: number;
  /** THREE.BufferAttribute fast path. Interleaved/normalized integer attributes use getters. */
  readonly array?: unknown;
  readonly isInterleavedBufferAttribute?: boolean;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

/** THREE.BufferGeometry와 구조적으로 호환된다. */
export interface StudioVrmTextureGeometryLike {
  readonly index: StudioVrmGeometryAttributeLike | null;
  getAttribute(name: string): StudioVrmGeometryAttributeLike | undefined;
}

export interface StudioVrmMatrix4Like {
  /** THREE.Matrix4와 같은 column-major 16개 성분. 이동 성분은 밀도 계산에서 무시한다. */
  readonly elements: ArrayLike<number>;
}

export interface StudioVrmTextureGeometryIndexOptions {
  /** glTF TEXCOORD_0=`uv`, TEXCOORD_1=`uv1`. */
  readonly uvAttribute?: string;
  /** 미지정 시 메시 바운드 크기에 비례해 자동 결정한다. */
  readonly positionEpsilon?: number;
  readonly uvEpsilon?: number;
  /** 제품 하드 상한 이내에서 더 낮은 가져오기 예산을 적용할 때 사용한다. */
  readonly maxTriangles?: number;
}

export interface StudioVrmTextureGeometryPrecomputeOptions
  extends StudioVrmTextureGeometryIndexOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Selected once before precomputation. Omission selects the product Worker. */
  readonly executionBackend?: StudioVrmTextureGeometryExecutionBackend;
  readonly workerFactory?: StudioVrmTextureGeometryWorkerFactory | null;
}

export type StudioVrmTextureGeometryPrecomputeErrorCode =
  | "geometry-invalid"
  | "geometry-stale"
  | "topology-invalid";

export class StudioVrmTextureGeometryPrecomputeError extends Error {
  constructor(readonly code: StudioVrmTextureGeometryPrecomputeErrorCode) {
    super(code);
    this.name = "StudioVrmTextureGeometryPrecomputeError";
  }
}

export interface StudioVrmTextureGeometryAdmission {
  readonly triangleCount: number;
  readonly maxTriangles: number;
  readonly admitted: boolean;
}

export interface StudioVrmTextureTriangleDensityOptions {
  /** 로컬 위치를 실제 월드 길이로 변환한다. 미지정 시 로컬 1단위를 월드 1단위로 본다. */
  readonly matrixWorld?: StudioVrmMatrix4Like;
  /**
   * 텍스처 matrix의 UV 선형부 determinant 절댓값.
   * repeat/rotation/scale이 없는 일반 glTF 텍스처는 기본값 1이다.
   */
  readonly uvAreaScale?: number;
}

export interface StudioVrmTextureTriangleIsland {
  /** 한 geometry/uvAttribute 인덱스 안에서 0부터 연속인 결정적 ID. */
  readonly id: number;
  /** 같은 geometry가 같은 삼각형 순서를 유지하는 동안 재빌드 후에도 안정적인 키. */
  readonly key: string;
  /** 연결 성분 안에서 가장 작은 faceIndex. */
  readonly anchorFaceIndex: number;
}

export interface StudioVrmTextureTrianglePaintClassification {
  readonly faceIndex: number;
  readonly island: StudioVrmTextureTriangleIsland;
  /** 퇴화 UV/월드 삼각형이면 null. */
  readonly texelsPerWorldUnit: number | null;
}

export interface StudioVrmTextureGeometryIndex {
  readonly triangleCount: number;
  readonly islandCount: number;
  readonly uvAttribute: string;
  getIsland(faceIndex: number): StudioVrmTextureTriangleIsland | null;
  getTexelsPerWorldUnit(
    faceIndex: number,
    textureSize: StudioVrmTextureSize,
    options?: StudioVrmTextureTriangleDensityOptions,
  ): number | null;
  resolvePaintClassification(
    faceIndex: number,
    textureSize: StudioVrmTextureSize,
    options?: StudioVrmTextureTriangleDensityOptions,
  ): StudioVrmTextureTrianglePaintClassification | null;
}

interface GeometrySignature {
  readonly position: StudioVrmGeometryAttributeLike | undefined;
  readonly positionVersion: number;
  readonly positionCount: number;
  readonly positionItemSize: number;
  readonly uv: StudioVrmGeometryAttributeLike | undefined;
  readonly uvVersion: number;
  readonly uvCount: number;
  readonly uvItemSize: number;
  readonly index: StudioVrmGeometryAttributeLike | null;
  readonly indexVersion: number;
  readonly indexCount: number;
}

interface GeometryCacheEntry {
  readonly signature: GeometrySignature;
  readonly index: StudioVrmTextureGeometryIndex | null;
}

interface VertexData {
  readonly position: readonly [number, number, number];
  readonly uv: readonly [number, number];
}

const geometryIndexCache = new WeakMap<
  StudioVrmTextureGeometryLike,
  Map<string, GeometryCacheEntry>
>();
const geometryInvalidationEpoch = new WeakMap<StudioVrmTextureGeometryLike, number>();

function finiteVersion(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function finiteCount(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : -1;
}

function finiteItemSize(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : -1;
}

function captureSignature(
  geometry: StudioVrmTextureGeometryLike,
  uvAttribute: string,
): GeometrySignature | null {
  try {
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute(uvAttribute);
    const index = geometry.index;
    return {
      position,
      positionVersion: finiteVersion(position?.version),
      positionCount: finiteCount(position?.count),
      positionItemSize: finiteItemSize(position?.itemSize),
      uv,
      uvVersion: finiteVersion(uv?.version),
      uvCount: finiteCount(uv?.count),
      uvItemSize: finiteItemSize(uv?.itemSize),
      index,
      indexVersion: finiteVersion(index?.version),
      indexCount: index ? finiteCount(index.count) : 0,
    };
  } catch {
    return null;
  }
}

function signaturesMatch(first: GeometrySignature, second: GeometrySignature): boolean {
  return (
    first.position === second.position &&
    first.positionVersion === second.positionVersion &&
    first.positionCount === second.positionCount &&
    first.positionItemSize === second.positionItemSize &&
    first.uv === second.uv &&
    first.uvVersion === second.uvVersion &&
    first.uvCount === second.uvCount &&
    first.uvItemSize === second.uvItemSize &&
    first.index === second.index &&
    first.indexVersion === second.indexVersion &&
    first.indexCount === second.indexCount
  );
}

function normalizedPositive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizedTriangleBudget(value: unknown): number {
  return Math.min(
    STUDIO_VRM_TEXTURE_GEOMETRY_MAX_TRIANGLES,
    Math.max(
      0,
      Number.isSafeInteger(value)
        ? (value as number)
        : STUDIO_VRM_TEXTURE_GEOMETRY_MAX_TRIANGLES,
    ),
  );
}

function optionCacheKey(options: StudioVrmTextureGeometryIndexOptions): string | null {
  const uvAttribute = options.uvAttribute ?? "uv";
  if (typeof uvAttribute !== "string" || uvAttribute.length === 0 || uvAttribute.length > 64) {
    return null;
  }
  const positionEpsilon =
    options.positionEpsilon === undefined
      ? "auto"
      : normalizedPositive(options.positionEpsilon, MIN_POSITION_EPSILON);
  const uvEpsilon = normalizedPositive(options.uvEpsilon, DEFAULT_UV_EPSILON);
  const maxTriangles = normalizedTriangleBudget(options.maxTriangles);
  return JSON.stringify([uvAttribute, positionEpsilon, uvEpsilon, maxTriangles]);
}

function precomputeFailure(code: StudioVrmTextureGeometryPrecomputeErrorCode): never {
  throw new StudioVrmTextureGeometryPrecomputeError(code);
}

function throwIfPrecomputeAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new StudioVrmTextureGeometryWorkerClientError("aborted");
}

function packedFloatView(
  attribute: StudioVrmGeometryAttributeLike,
  componentCount: number,
  count: number,
): StudioVrmTextureGeometryFloatSource | null {
  const source = attribute.array;
  if (
    attribute.isInterleavedBufferAttribute === true ||
    attribute.itemSize !== componentCount ||
    attribute.count < count ||
    !(source instanceof Float32Array || source instanceof Float64Array) ||
    source.length < count * componentCount
  ) return null;
  return source.subarray(0, count * componentCount);
}

function readPackedAttribute(
  attribute: StudioVrmGeometryAttributeLike,
  componentCount: 2 | 3,
  outputCount: number,
  signal: AbortSignal | undefined,
): StudioVrmTextureGeometryFloatSource {
  const direct = packedFloatView(attribute, componentCount, outputCount);
  if (direct) return direct;
  const output = new Float64Array(outputCount * componentCount);
  // UV count may be shorter than position count. NaN preserves the synchronous index's
  // triangle-local invalidation instead of silently inventing zero UVs.
  output.fill(Number.NaN);
  const readableCount = Math.min(outputCount, attribute.count);
  try {
    for (let index = 0; index < readableCount; index += 1) {
      if ((index & 0x1fff) === 0) throwIfPrecomputeAborted(signal);
      const offset = index * componentCount;
      output[offset] = attribute.getX(index);
      output[offset + 1] = attribute.getY(index);
      if (componentCount === 3) output[offset + 2] = attribute.getZ(index);
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    precomputeFailure("geometry-invalid");
  }
  return output;
}

function packedIndexView(
  index: StudioVrmGeometryAttributeLike,
): StudioVrmTextureGeometryIndexSource | null {
  const source = index.array;
  if (
    index.isInterleavedBufferAttribute === true ||
    index.itemSize !== 1 ||
    !(
      source instanceof Uint8Array ||
      source instanceof Uint16Array ||
      source instanceof Uint32Array
    ) ||
    source.length < index.count
  ) return null;
  return source.subarray(0, index.count);
}

function readPackedIndex(
  index: StudioVrmGeometryAttributeLike,
  signal: AbortSignal | undefined,
): StudioVrmTextureGeometryIndexSource {
  const direct = packedIndexView(index);
  if (direct) return direct;
  const output = new Uint32Array(index.count);
  try {
    for (let offset = 0; offset < index.count; offset += 1) {
      if ((offset & 0x1fff) === 0) throwIfPrecomputeAborted(signal);
      const value = index.getX(offset);
      // Invalid fractional/negative/oversized indices remain triangle-local invalid data in the
      // Worker instead of being truncated into a potentially valid vertex.
      output[offset] = Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff
        ? value
        : 0xffff_ffff;
    }
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    precomputeFailure("geometry-invalid");
  }
  return output;
}

function snapshotGeometryForWorker(
  signature: GeometrySignature,
  options: StudioVrmTextureGeometryIndexOptions,
  signal: AbortSignal | undefined,
): StudioVrmTextureGeometryWorkerInput {
  const position = signature.position;
  const uv = signature.uv;
  if (
    !position ||
    !uv ||
    position.itemSize < 3 ||
    uv.itemSize < 2 ||
    position.count < 3
  ) precomputeFailure("geometry-invalid");
  if (position.count > STUDIO_VRM_TEXTURE_GEOMETRY_WORKER_MAX_VERTICES) {
    throw new StudioVrmTextureGeometryWorkerClientError("vertex-budget-exceeded");
  }
  const flatVertexCount = signature.index ? signature.indexCount : signature.positionCount;
  if (flatVertexCount < 3 || flatVertexCount % 3 !== 0) {
    precomputeFailure("geometry-invalid");
  }
  const maxTriangles = normalizedTriangleBudget(options.maxTriangles);
  if (flatVertexCount / 3 > maxTriangles) {
    throw new StudioVrmTextureGeometryWorkerClientError("triangle-budget-exceeded");
  }
  throwIfPrecomputeAborted(signal);
  return {
    positions: readPackedAttribute(position, 3, signature.positionCount, signal),
    uvs: readPackedAttribute(uv, 2, signature.positionCount, signal),
    indices: signature.index ? readPackedIndex(signature.index, signal) : null,
    uvAttribute: options.uvAttribute ?? "uv",
    positionEpsilon: options.positionEpsilon === undefined
      ? undefined
      : normalizedPositive(options.positionEpsilon, MIN_POSITION_EPSILON),
    uvEpsilon: normalizedPositive(options.uvEpsilon, DEFAULT_UV_EPSILON),
    // The client requires a positive limit. A zero caller budget has already failed above.
    maxTriangles: Math.max(1, maxTriangles),
  };
}

function resolvePositionEpsilon(
  position: StudioVrmGeometryAttributeLike,
  configured: number | undefined,
): number {
  if (configured !== undefined) return normalizedPositive(configured, MIN_POSITION_EPSILON);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    const x = position.getX(vertexIndex);
    const y = position.getY(vertexIndex);
    const z = position.getZ(vertexIndex);
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

function readVertex(
  position: StudioVrmGeometryAttributeLike,
  uv: StudioVrmGeometryAttributeLike,
  vertexIndex: number,
): VertexData | null {
  if (!Number.isSafeInteger(vertexIndex) || vertexIndex < 0) return null;
  if (vertexIndex >= position.count || vertexIndex >= uv.count) return null;
  const x = position.getX(vertexIndex);
  const y = position.getY(vertexIndex);
  const z = position.getZ(vertexIndex);
  const u = uv.getX(vertexIndex);
  const v = uv.getY(vertexIndex);
  if (![x, y, z, u, v].every(Number.isFinite)) return null;
  return { position: [x, y, z], uv: [u, v] };
}

function quantized(value: number, epsilon: number): string {
  const rounded = Math.round(value / epsilon);
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function vertexTopologyKey(
  vertex: VertexData,
  positionEpsilon: number,
  uvEpsilon: number,
): string {
  return [
    quantized(vertex.position[0], positionEpsilon),
    quantized(vertex.position[1], positionEpsilon),
    quantized(vertex.position[2], positionEpsilon),
    quantized(vertex.uv[0], uvEpsilon),
    quantized(vertex.uv[1], uvEpsilon),
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
  const lower = Math.min(firstRoot, secondRoot);
  const higher = Math.max(firstRoot, secondRoot);
  parents[higher] = lower;
}

function readTriangleVertexIndex(
  index: StudioVrmGeometryAttributeLike | null,
  flatVertexIndex: number,
): number | null {
  const value = index ? index.getX(flatVertexIndex) : flatVertexIndex;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function validFaceIndex(faceIndex: number, triangleCount: number): boolean {
  return Number.isSafeInteger(faceIndex) && faceIndex >= 0 && faceIndex < triangleCount;
}

function matrixElements(
  matrix: StudioVrmMatrix4Like | undefined,
): readonly number[] | null | undefined {
  if (!matrix) return undefined;
  const source = matrix.elements;
  if (!source || source.length < 16) return null;
  const indices = [0, 1, 2, 4, 5, 6, 8, 9, 10] as const;
  const values = indices.map((index) => source[index]);
  return values.every((value) => typeof value === "number" && Number.isFinite(value))
    ? (values as readonly number[])
    : null;
}

function transformedEdge(
  x: number,
  y: number,
  z: number,
  linear: readonly number[] | undefined,
): readonly [number, number, number] {
  if (!linear) return [x, y, z];
  return [
    linear[0]! * x + linear[3]! * y + linear[6]! * z,
    linear[1]! * x + linear[4]! * y + linear[7]! * z,
    linear[2]! * x + linear[5]! * y + linear[8]! * z,
  ];
}

function buildGeometryIndex(
  signature: GeometrySignature,
  options: StudioVrmTextureGeometryIndexOptions,
): StudioVrmTextureGeometryIndex | null {
  const position = signature.position;
  const uv = signature.uv;
  const index = signature.index;
  if (!position || !uv || position.itemSize < 3 || uv.itemSize < 2) return null;
  const flatVertexCount = index ? index.count : position.count;
  if (!Number.isSafeInteger(flatVertexCount) || flatVertexCount < 3 || flatVertexCount % 3 !== 0) {
    return null;
  }
  const triangleCount = flatVertexCount / 3;
  const maxTriangles = normalizedTriangleBudget(options.maxTriangles);
  if (triangleCount > maxTriangles) return null;

  const uvAttribute = options.uvAttribute ?? "uv";
  const positionEpsilon = resolvePositionEpsilon(position, options.positionEpsilon);
  const uvEpsilon = normalizedPositive(options.uvEpsilon, DEFAULT_UV_EPSILON);
  const parents = new Int32Array(triangleCount);
  const validTriangles = new Uint8Array(triangleCount);
  const uvDoubleAreas = new Float64Array(triangleCount);
  const localEdges = new Float64Array(triangleCount * 6);
  const edgeOwners = new Map<string, number>();
  for (let faceIndex = 0; faceIndex < triangleCount; faceIndex += 1) {
    parents[faceIndex] = faceIndex;
    const base = faceIndex * 3;
    const vertexIndices = [
      readTriangleVertexIndex(index, base),
      readTriangleVertexIndex(index, base + 1),
      readTriangleVertexIndex(index, base + 2),
    ] as const;
    if (vertexIndices.some((value) => value === null)) continue;
    const a = readVertex(position, uv, vertexIndices[0] as number);
    const b = readVertex(position, uv, vertexIndices[1] as number);
    const c = readVertex(position, uv, vertexIndices[2] as number);
    if (!a || !b || !c) continue;
    const vertices = [a, b, c] as const;
    validTriangles[faceIndex] = 1;

    const edgeOffset = faceIndex * 6;
    localEdges[edgeOffset] = b.position[0] - a.position[0];
    localEdges[edgeOffset + 1] = b.position[1] - a.position[1];
    localEdges[edgeOffset + 2] = b.position[2] - a.position[2];
    localEdges[edgeOffset + 3] = c.position[0] - a.position[0];
    localEdges[edgeOffset + 4] = c.position[1] - a.position[1];
    localEdges[edgeOffset + 5] = c.position[2] - a.position[2];
    uvDoubleAreas[faceIndex] = Math.abs(
      (b.uv[0] - a.uv[0]) * (c.uv[1] - a.uv[1]) -
        (c.uv[0] - a.uv[0]) * (b.uv[1] - a.uv[1]),
    );

    const vertexKeys = vertices.map((vertex) =>
      vertexTopologyKey(vertex as VertexData, positionEpsilon, uvEpsilon),
    );
    const edgePairs = [
      [vertexKeys[0]!, vertexKeys[1]!],
      [vertexKeys[1]!, vertexKeys[2]!],
      [vertexKeys[2]!, vertexKeys[0]!],
    ] as const;
    for (const [first, second] of edgePairs) {
      const edgeKey = edgeTopologyKey(first, second);
      if (!edgeKey) continue;
      const owner = edgeOwners.get(edgeKey);
      if (owner === undefined) edgeOwners.set(edgeKey, faceIndex);
      else unionByMinimumRoot(parents, owner, faceIndex);
    }
  }

  const triangleIslandIds = new Int32Array(triangleCount);
  triangleIslandIds.fill(-1);
  const islandAnchors: number[] = [];
  const rootToIsland = new Map<number, number>();
  for (let faceIndex = 0; faceIndex < triangleCount; faceIndex += 1) {
    if (validTriangles[faceIndex] === 0) continue;
    const root = findRoot(parents, faceIndex);
    let islandId = rootToIsland.get(root);
    if (islandId === undefined) {
      islandId = islandAnchors.length;
      rootToIsland.set(root, islandId);
      islandAnchors.push(root);
    }
    triangleIslandIds[faceIndex] = islandId;
  }

  function getIsland(faceIndex: number): StudioVrmTextureTriangleIsland | null {
    if (!validFaceIndex(faceIndex, triangleCount)) return null;
    const id = triangleIslandIds[faceIndex]!;
    if (id < 0) return null;
    const anchorFaceIndex = islandAnchors[id]!;
    return Object.freeze({
      id,
      key: `${uvAttribute}:${anchorFaceIndex}`,
      anchorFaceIndex,
    });
  }

  function getTexelsPerWorldUnit(
    faceIndex: number,
    textureSize: StudioVrmTextureSize,
    densityOptions: StudioVrmTextureTriangleDensityOptions = {},
  ): number | null {
    if (!validFaceIndex(faceIndex, triangleCount) || !isStudioVrmTextureSize(textureSize)) {
      return null;
    }
    if (triangleIslandIds[faceIndex] === -1) return null;
    const uvDoubleArea = uvDoubleAreas[faceIndex]!;
    if (!(uvDoubleArea > 0)) return null;
    const linear = matrixElements(densityOptions.matrixWorld);
    if (linear === null) return null;
    const offset = faceIndex * 6;
    const first = transformedEdge(
      localEdges[offset]!,
      localEdges[offset + 1]!,
      localEdges[offset + 2]!,
      linear,
    );
    const second = transformedEdge(
      localEdges[offset + 3]!,
      localEdges[offset + 4]!,
      localEdges[offset + 5]!,
      linear,
    );
    const crossX = first[1] * second[2] - first[2] * second[1];
    const crossY = first[2] * second[0] - first[0] * second[2];
    const crossZ = first[0] * second[1] - first[1] * second[0];
    const worldDoubleArea = Math.hypot(crossX, crossY, crossZ);
    if (!(worldDoubleArea > 0)) return null;
    const uvAreaScale =
      densityOptions.uvAreaScale === undefined ? 1 : densityOptions.uvAreaScale;
    if (!Number.isFinite(uvAreaScale) || !(uvAreaScale > 0)) return null;
    const density = Math.sqrt(
      (uvDoubleArea *
        uvAreaScale *
        textureSize.width *
        textureSize.height) /
        worldDoubleArea,
    );
    return Number.isFinite(density) && density > 0 ? density : null;
  }

  return Object.freeze({
    triangleCount,
    islandCount: islandAnchors.length,
    uvAttribute,
    getIsland,
    getTexelsPerWorldUnit,
    resolvePaintClassification(
      faceIndex: number,
      textureSize: StudioVrmTextureSize,
      densityOptions: StudioVrmTextureTriangleDensityOptions = {},
    ): StudioVrmTextureTrianglePaintClassification | null {
      const island = getIsland(faceIndex);
      if (!island) return null;
      return Object.freeze({
        faceIndex,
        island,
        texelsPerWorldUnit: getTexelsPerWorldUnit(faceIndex, textureSize, densityOptions),
      });
    },
  });
}

function buildGeometryIndexFromWorkerTopology(
  topology: StudioVrmTextureGeometryWorkerTopology,
): StudioVrmTextureGeometryIndex {
  if (
    !isStudioVrmTextureGeometryWorkerTopology(topology) ||
    !hasValidStudioVrmTextureGeometryWorkerTopologyNumbers(topology)
  ) precomputeFailure("topology-invalid");
  const {
    triangleCount,
    islandCount,
    uvAttribute,
    triangleIslandIds,
    islandAnchors,
    uvDoubleAreas,
    localEdges,
  } = topology;

  function getIsland(faceIndex: number): StudioVrmTextureTriangleIsland | null {
    if (!validFaceIndex(faceIndex, triangleCount)) return null;
    const id = triangleIslandIds[faceIndex]!;
    if (id < 0) return null;
    const anchorFaceIndex = islandAnchors[id]!;
    return Object.freeze({
      id,
      key: `${uvAttribute}:${anchorFaceIndex}`,
      anchorFaceIndex,
    });
  }

  function getTexelsPerWorldUnit(
    faceIndex: number,
    textureSize: StudioVrmTextureSize,
    densityOptions: StudioVrmTextureTriangleDensityOptions = {},
  ): number | null {
    if (!validFaceIndex(faceIndex, triangleCount) || !isStudioVrmTextureSize(textureSize)) {
      return null;
    }
    if (triangleIslandIds[faceIndex] === -1) return null;
    const uvDoubleArea = uvDoubleAreas[faceIndex]!;
    if (!(uvDoubleArea > 0)) return null;
    const linear = matrixElements(densityOptions.matrixWorld);
    if (linear === null) return null;
    const offset = faceIndex * 6;
    const first = transformedEdge(
      localEdges[offset]!,
      localEdges[offset + 1]!,
      localEdges[offset + 2]!,
      linear,
    );
    const second = transformedEdge(
      localEdges[offset + 3]!,
      localEdges[offset + 4]!,
      localEdges[offset + 5]!,
      linear,
    );
    const crossX = first[1] * second[2] - first[2] * second[1];
    const crossY = first[2] * second[0] - first[0] * second[2];
    const crossZ = first[0] * second[1] - first[1] * second[0];
    const worldDoubleArea = Math.hypot(crossX, crossY, crossZ);
    if (!(worldDoubleArea > 0)) return null;
    const uvAreaScale =
      densityOptions.uvAreaScale === undefined ? 1 : densityOptions.uvAreaScale;
    if (!Number.isFinite(uvAreaScale) || !(uvAreaScale > 0)) return null;
    const density = Math.sqrt(
      (uvDoubleArea *
        uvAreaScale *
        textureSize.width *
        textureSize.height) /
        worldDoubleArea,
    );
    return Number.isFinite(density) && density > 0 ? density : null;
  }

  return Object.freeze({
    triangleCount,
    islandCount,
    uvAttribute,
    getIsland,
    getTexelsPerWorldUnit,
    resolvePaintClassification(
      faceIndex: number,
      textureSize: StudioVrmTextureSize,
      densityOptions: StudioVrmTextureTriangleDensityOptions = {},
    ): StudioVrmTextureTrianglePaintClassification | null {
      const island = getIsland(faceIndex);
      if (!island) return null;
      return Object.freeze({
        faceIndex,
        island,
        texelsPerWorldUnit: getTexelsPerWorldUnit(faceIndex, textureSize, densityOptions),
      });
    },
  });
}

/**
 * UV 인덱스를 실제로 만들기 전에 삼각형 수만 상수 시간으로 검사한다.
 * 대형 메시가 동기 topology build에 진입하지 않도록 pointerdown 경로에서 사용한다.
 */
export function inspectStudioVrmTextureGeometryAdmission(
  geometry: StudioVrmTextureGeometryLike,
  options: Pick<StudioVrmTextureGeometryIndexOptions, "maxTriangles" | "uvAttribute"> = {},
): StudioVrmTextureGeometryAdmission | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const uvAttribute = options.uvAttribute ?? "uv";
  if (typeof uvAttribute !== "string" || uvAttribute.length === 0 || uvAttribute.length > 64) {
    return null;
  }
  const signature = captureSignature(geometry, uvAttribute);
  const position = signature?.position;
  if (!signature || !position || position.itemSize < 3) return null;
  const flatVertexCount = signature.index ? signature.indexCount : signature.positionCount;
  if (
    !Number.isSafeInteger(flatVertexCount)
    || flatVertexCount < 3
    || flatVertexCount % 3 !== 0
  ) {
    return null;
  }
  const triangleCount = flatVertexCount / 3;
  const maxTriangles = normalizedTriangleBudget(options.maxTriangles);
  return Object.freeze({
    triangleCount,
    maxTriangles,
    admitted: triangleCount <= maxTriangles,
  });
}

/**
 * Returns only an already-built, signature-current index.
 *
 * Unlike `getStudioVrmTextureGeometryIndex`, this function never scans vertex/index coordinates
 * and never installs a negative cache entry. Pointer-input paths use it for Worker-prewarmed
 * meshes so a cache miss can fall back to the hit face without blocking the main thread.
 */
export function getCachedStudioVrmTextureGeometryIndex(
  geometry: StudioVrmTextureGeometryLike,
  options: StudioVrmTextureGeometryIndexOptions = {},
): StudioVrmTextureGeometryIndex | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const cacheKey = optionCacheKey(options);
  if (!cacheKey) return null;
  const signature = captureSignature(geometry, options.uvAttribute ?? "uv");
  if (!signature) return null;
  const cached = geometryIndexCache.get(geometry)?.get(cacheKey);
  return cached && signaturesMatch(cached.signature, signature)
    ? cached.index
    : null;
}

/**
 * geometry + UV attribute + 허용오차 조합별 캐시된 인덱스를 반환한다.
 * 같은 attribute/index 버전에서는 참조 동일성도 보장된다.
 */
export function getStudioVrmTextureGeometryIndex(
  geometry: StudioVrmTextureGeometryLike,
  options: StudioVrmTextureGeometryIndexOptions = {},
): StudioVrmTextureGeometryIndex | null {
  if (typeof geometry !== "object" || geometry === null) return null;
  const cacheKey = optionCacheKey(options);
  if (!cacheKey) return null;
  const uvAttribute = options.uvAttribute ?? "uv";
  const signature = captureSignature(geometry, uvAttribute);
  if (!signature) return null;
  let geometryCache = geometryIndexCache.get(geometry);
  if (!geometryCache) {
    geometryCache = new Map();
    geometryIndexCache.set(geometry, geometryCache);
  }
  const cached = geometryCache.get(cacheKey);
  if (cached && signaturesMatch(cached.signature, signature)) return cached.index;
  const index = buildGeometryIndex(signature, options);
  geometryCache.set(cacheKey, { signature, index });
  return index;
}

/**
 * Builds the same island/density lookup contract in a Worker before pointer input begins.
 *
 * Successful results enter the existing geometry/version/options cache, so later synchronous
 * `getStudioVrmTextureGeometryIndex` calls return this object by identity and do no topology work.
 * Worker/client abort, timeout, availability, and budget errors intentionally propagate unchanged.
 */
export async function precomputeStudioVrmTextureGeometryIndex(
  geometry: StudioVrmTextureGeometryLike,
  options: StudioVrmTextureGeometryPrecomputeOptions = {},
): Promise<StudioVrmTextureGeometryIndex> {
  throwIfPrecomputeAborted(options.signal);
  if (typeof geometry !== "object" || geometry === null) {
    precomputeFailure("geometry-invalid");
  }
  const cacheKey = optionCacheKey(options);
  if (!cacheKey) precomputeFailure("geometry-invalid");
  const uvAttribute = options.uvAttribute ?? "uv";
  const signature = captureSignature(geometry, uvAttribute);
  if (!signature) precomputeFailure("geometry-invalid");
  const invalidationEpoch = geometryInvalidationEpoch.get(geometry) ?? 0;
  const cached = geometryIndexCache.get(geometry)?.get(cacheKey);
  if (cached && signaturesMatch(cached.signature, signature)) {
    if (cached.index) return cached.index;
    precomputeFailure("geometry-invalid");
  }

  const input = snapshotGeometryForWorker(signature, options, options.signal);
  const workerOptions: StudioVrmTextureGeometryWorkerBuildOptions = {
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    executionBackend: options.executionBackend,
    workerFactory: options.workerFactory,
  };
  const result = await buildStudioVrmTextureGeometryTopologyInWorker(input, workerOptions);
  throwIfPrecomputeAborted(options.signal);
  const currentSignature = captureSignature(geometry, uvAttribute);
  if (
    !currentSignature ||
    !signaturesMatch(signature, currentSignature) ||
    (geometryInvalidationEpoch.get(geometry) ?? 0) !== invalidationEpoch
  ) {
    precomputeFailure("geometry-stale");
  }
  const index = buildGeometryIndexFromWorkerTopology(result.topology);
  let geometryCache = geometryIndexCache.get(geometry);
  if (!geometryCache) {
    geometryCache = new Map();
    geometryIndexCache.set(geometry, geometryCache);
  }
  geometryCache.set(cacheKey, { signature: currentSignature, index });
  return index;
}

/**
 * attribute 배열을 Three의 `needsUpdate` 없이 직접 바꾼 특수 경로에서만 필요하다.
 * 일반 BufferAttribute 갱신은 version 변경으로 자동 무효화된다.
 */
export function invalidateStudioVrmTextureGeometryIndex(
  geometry: StudioVrmTextureGeometryLike,
): void {
  geometryIndexCache.delete(geometry);
  const epoch = geometryInvalidationEpoch.get(geometry) ?? 0;
  geometryInvalidationEpoch.set(
    geometry,
    epoch >= Number.MAX_SAFE_INTEGER ? 1 : epoch + 1,
  );
}
