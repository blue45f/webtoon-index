/**
 * 지오메트리 노드 — 메시 연산(transform / join / subdivide / extrude /
 * instance-on-points / distribute-points-on-faces / attribute-math).
 *
 * 전부 순수 함수다. 입력 메시는 절대 변형하지 않고 새 Float32Array/Uint32Array 를 만든다.
 * 실패는 예외가 아니라 `StudioGeometryResult` 의 `{ ok:false, code }` 로 나온다.
 *
 * ## 알고리즘 요약과 정직한 한계
 * - **transform**: TRS. 회전은 XYZ 오일러 → 3×3 행렬(three.js `Euler('XYZ')` 와 동일한
 *   성분 배치라 3D 배경 씬 트랜스폼과 결과가 일치). sin/cos 는 양자화된 것만 쓴다.
 *   법선은 회전 후 역스케일(1/s)을 곱하고 정규화한다(비균일 스케일 대응).
 * - **join**: 인덱스 오프셋 병합. UV 는 한쪽이라도 없으면 결과도 없다(가짜 UV 를 만들지 않음).
 * - **subdivide**: **선형** 1→4 midpoint 분할. F→4F, V→V+E(E = 고유 엣지 수)로 정확히 커진다.
 *   Catmull-Clark 극한 곡면이 **아니다** — 형태가 부드러워지지 않고 각진 채로 조밀해질 뿐이다.
 * - **extrude**: 정점 법선 방향 균일 오프셋(솔리디파이). 열린 메시면 경계 엣지마다 측면 쿼드
 *   2삼각형이 붙어 닫힌 솔리드가 된다. 위상적으로 닫힌 메시는 경계 엣지가 없으므로 껍데기만
 *   복제된다. **개별 면 분리 압출·인셋(inset)은 없다.**
 *   *함정*: 프리미티브(cube/sphere/cylinder)는 면 법선·UV 를 위해 정점을 **면마다 분리**해
 *   두었으므로 눈에는 닫혀 보여도 위상적으로는 열려 있다. 그대로 압출하면 면마다 측면 벽이
 *   생긴다(큐브 12면 → 72면). 껍데기 오프셋을 원하면 `studioGeometryMergeVertices` 로 먼저
 *   병합해야 한다 — 이 동작은 버그가 아니라 위상 그대로의 결과이며 테스트로 고정해 두었다.
 * - **instance-on-points**: 포인트마다 인스턴스 메시를 배치. 인스턴스 수는 예산(기본 1024)으로
 *   상한. 난수 소비 순서는 "회전 3개 → 스케일 1개" 로 고정이며 그 순서가 곧 출력 정체성이다.
 * - **distribute-points-on-faces**: 면적 누적 배열 + 이진 탐색으로 면을 뽑고, 제곱근 접기
 *   배리센트릭으로 삼각형 안 균일 샘플. 포인트당 난수 정확히 3개(면 1 + 배리센트릭 2).
 *   푸아송 디스크가 **아니다** — 최소 간격을 보장하지 않는다.
 * - **attribute-math**: point/face 도메인의 float·vec3 속성 산술. 0 나눗셈은 0 으로
 *   수렴시킨다(블렌더와 같은 규약).
 */

import {
  createStudioGeometryMesh,
  createStudioGeometryPoints,
  STUDIO_GEOMETRY_DEFAULT_BUDGETS,
  studioGeometryBoundaryEdges,
  studioGeometryClamp,
  studioGeometryComputeVertexNormals,
  studioGeometryCos,
  studioGeometryFail,
  studioGeometryFaceNormal,
  studioGeometryOk,
  studioGeometryPointCount,
  studioGeometrySin,
  studioGeometryTriangleArea,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";
import {
  createStudioGeometryRandom,
  studioGeometryRandomBarycentric,
} from "./studio-geometry-nodes-random";

import type {
  StudioGeometryAttribute,
  StudioGeometryBudgets,
  StudioGeometryMesh,
  StudioGeometryPoints,
  StudioGeometryResult,
} from "./studio-geometry-nodes-mesh";

const TWO_PI = Math.PI * 2;

export type StudioGeometryVec3 = readonly [number, number, number];

// ---------------------------------------------------------------------------
// transform
// ---------------------------------------------------------------------------

export interface StudioGeometryTransformParams {
  readonly translate?: StudioGeometryVec3;
  /** XYZ 오일러(라디안). */
  readonly rotate?: StudioGeometryVec3;
  readonly scale?: StudioGeometryVec3;
}

/** 행 우선 3×3 회전 행렬 — three.js `Matrix4.makeRotationFromEuler('XYZ')` 와 동일 성분. */
export function studioGeometryEulerMatrix(rotate: StudioGeometryVec3): number[] {
  const [x, y, z] = rotate;
  const c1 = studioGeometryCos(x);
  const s1 = studioGeometrySin(x);
  const c2 = studioGeometryCos(y);
  const s2 = studioGeometrySin(y);
  const c3 = studioGeometryCos(z);
  const s3 = studioGeometrySin(z);
  return [
    c2 * c3,
    -c2 * s3,
    s2,
    c1 * s3 + s1 * s2 * c3,
    c1 * c3 - s1 * s2 * s3,
    -s1 * c2,
    s1 * s3 - c1 * s2 * c3,
    s1 * c3 + c1 * s2 * s3,
    c1 * c2,
  ];
}

function safeVec3(value: StudioGeometryVec3 | undefined, fallback: number): StudioGeometryVec3 {
  if (!value) return [fallback, fallback, fallback];
  const pick = (v: number): number => (Number.isFinite(v) ? v : fallback);
  return [pick(value[0]), pick(value[1]), pick(value[2])];
}

export function studioGeometryTransform(
  mesh: StudioGeometryMesh,
  params: StudioGeometryTransformParams,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const translate = safeVec3(params.translate, 0);
  const rotate = safeVec3(params.rotate, 0);
  const rawScale = safeVec3(params.scale, 1);
  const scale: StudioGeometryVec3 = [
    rawScale[0] === 0 ? 1e-6 : rawScale[0],
    rawScale[1] === 0 ? 1e-6 : rawScale[1],
    rawScale[2] === 0 ? 1e-6 : rawScale[2],
  ];
  const m = studioGeometryEulerMatrix(rotate);
  const count = studioGeometryVertexCount(mesh);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const x = mesh.positions[i * 3] * scale[0];
    const y = mesh.positions[i * 3 + 1] * scale[1];
    const z = mesh.positions[i * 3 + 2] * scale[2];
    positions[i * 3] = m[0] * x + m[1] * y + m[2] * z + translate[0];
    positions[i * 3 + 1] = m[3] * x + m[4] * y + m[5] * z + translate[1];
    positions[i * 3 + 2] = m[6] * x + m[7] * y + m[8] * z + translate[2];
  }
  let normals: Float32Array | null = null;
  if (mesh.normals) {
    normals = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = mesh.normals[i * 3] / scale[0];
      const y = mesh.normals[i * 3 + 1] / scale[1];
      const z = mesh.normals[i * 3 + 2] / scale[2];
      const rx = m[0] * x + m[1] * y + m[2] * z;
      const ry = m[3] * x + m[4] * y + m[5] * z;
      const rz = m[6] * x + m[7] * y + m[8] * z;
      const length = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (length > 0) {
        normals[i * 3] = rx / length;
        normals[i * 3 + 1] = ry / length;
        normals[i * 3 + 2] = rz / length;
      } else {
        normals[i * 3 + 2] = 1;
      }
    }
  }
  return createStudioGeometryMesh(
    { positions, indices: Uint32Array.from(mesh.indices), normals, uvs: cloneOrNull(mesh.uvs) },
    budgets
  );
}

function cloneOrNull(array: Float32Array | null): Float32Array | null {
  return array ? Float32Array.from(array) : null;
}

// ---------------------------------------------------------------------------
// join
// ---------------------------------------------------------------------------

export function studioGeometryJoin(
  meshes: readonly StudioGeometryMesh[],
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const nonEmpty = meshes.filter((mesh) => mesh.positions.length > 0);
  if (nonEmpty.length === 0) {
    return createStudioGeometryMesh(
      { positions: new Float32Array(0), indices: new Uint32Array(0) },
      budgets
    );
  }
  let totalVertices = 0;
  let totalIndices = 0;
  let hasUvs = true;
  for (const mesh of nonEmpty) {
    totalVertices += studioGeometryVertexCount(mesh);
    totalIndices += mesh.indices.length;
    if (!mesh.uvs) hasUvs = false;
  }
  if (totalVertices > budgets.maxVertices || totalIndices / 3 > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `join → ${totalVertices}v/${totalIndices / 3}f`);
  }
  const positions = new Float32Array(totalVertices * 3);
  const normals = new Float32Array(totalVertices * 3);
  const uvs = hasUvs ? new Float32Array(totalVertices * 2) : null;
  const indices = new Uint32Array(totalIndices);
  let vertexOffset = 0;
  let indexOffset = 0;
  for (const mesh of nonEmpty) {
    const count = studioGeometryVertexCount(mesh);
    positions.set(mesh.positions, vertexOffset * 3);
    normals.set(mesh.normals ?? studioGeometryComputeVertexNormals(mesh), vertexOffset * 3);
    if (uvs && mesh.uvs) uvs.set(mesh.uvs, vertexOffset * 2);
    for (let i = 0; i < mesh.indices.length; i++) {
      indices[indexOffset + i] = mesh.indices[i] + vertexOffset;
    }
    vertexOffset += count;
    indexOffset += mesh.indices.length;
  }
  return createStudioGeometryMesh({ positions, indices, normals, uvs }, budgets);
}

// ---------------------------------------------------------------------------
// subdivide (linear midpoint 1 → 4)
// ---------------------------------------------------------------------------

export const STUDIO_GEOMETRY_MAX_SUBDIVIDE_ITERATIONS = 4;

function subdivideOnce(
  mesh: StudioGeometryMesh,
  budgets: StudioGeometryBudgets
): StudioGeometryResult<StudioGeometryMesh> {
  const vertexCount = studioGeometryVertexCount(mesh);
  const triangleCount = studioGeometryTriangleCount(mesh);
  if (triangleCount * 4 > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `subdivide → ${triangleCount * 4}f`);
  }
  const positions: number[] = Array.from(mesh.positions);
  const normals: number[] | null = mesh.normals ? Array.from(mesh.normals) : null;
  const uvs: number[] | null = mesh.uvs ? Array.from(mesh.uvs) : null;
  const midpoints = new Map<number, number>();
  const midpointOf = (a: number, b: number): number => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * vertexCount + hi;
    const existing = midpoints.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(
      (mesh.positions[lo * 3] + mesh.positions[hi * 3]) / 2,
      (mesh.positions[lo * 3 + 1] + mesh.positions[hi * 3 + 1]) / 2,
      (mesh.positions[lo * 3 + 2] + mesh.positions[hi * 3 + 2]) / 2
    );
    if (normals && mesh.normals) {
      const nx = (mesh.normals[lo * 3] + mesh.normals[hi * 3]) / 2;
      const ny = (mesh.normals[lo * 3 + 1] + mesh.normals[hi * 3 + 1]) / 2;
      const nz = (mesh.normals[lo * 3 + 2] + mesh.normals[hi * 3 + 2]) / 2;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (length > 0) normals.push(nx / length, ny / length, nz / length);
      else normals.push(0, 0, 1);
    }
    if (uvs && mesh.uvs) {
      uvs.push(
        (mesh.uvs[lo * 2] + mesh.uvs[hi * 2]) / 2,
        (mesh.uvs[lo * 2 + 1] + mesh.uvs[hi * 2 + 1]) / 2
      );
    }
    midpoints.set(key, index);
    return index;
  };
  const indices: number[] = [];
  for (let t = 0; t < triangleCount; t++) {
    const a = mesh.indices[t * 3];
    const b = mesh.indices[t * 3 + 1];
    const c = mesh.indices[t * 3 + 2];
    const ab = midpointOf(a, b);
    const bc = midpointOf(b, c);
    const ca = midpointOf(c, a);
    indices.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  if (positions.length / 3 > budgets.maxVertices) {
    return studioGeometryFail("budget-exceeded", `subdivide → ${positions.length / 3}v`);
  }
  return createStudioGeometryMesh(
    {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      normals: normals ? new Float32Array(normals) : null,
      uvs: uvs ? new Float32Array(uvs) : null,
    },
    budgets
  );
}

export function studioGeometrySubdivide(
  mesh: StudioGeometryMesh,
  iterations: number,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const count = Number.isFinite(iterations)
    ? studioGeometryClamp(Math.trunc(iterations), 0, STUDIO_GEOMETRY_MAX_SUBDIVIDE_ITERATIONS)
    : 0;
  let current = mesh;
  for (let i = 0; i < count; i++) {
    const next = subdivideOnce(current, budgets);
    if (!next.ok) return next;
    current = next.value;
  }
  return studioGeometryOk(current);
}

/** 고유 엣지 수 — subdivide 후 정점 수 V + E 를 검증할 때 쓰는 공식 항. */
export function studioGeometryUniqueEdgeCount(mesh: StudioGeometryMesh): number {
  const vertexCount = studioGeometryVertexCount(mesh);
  const seen = new Set<number>();
  const triangleCount = studioGeometryTriangleCount(mesh);
  for (let t = 0; t < triangleCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[t * 3 + k];
      const b = mesh.indices[t * 3 + ((k + 1) % 3)];
      seen.add(Math.min(a, b) * vertexCount + Math.max(a, b));
    }
  }
  return seen.size;
}

// ---------------------------------------------------------------------------
// extrude (solidify)
// ---------------------------------------------------------------------------

export interface StudioGeometryExtrudeParams {
  readonly distance: number;
  /** 원본 면을 뒤집어 바닥 캡으로 남길지(기본 true → 닫힌 솔리드). */
  readonly capOriginal?: boolean;
}

export function studioGeometryExtrude(
  mesh: StudioGeometryMesh,
  params: StudioGeometryExtrudeParams,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const vertexCount = studioGeometryVertexCount(mesh);
  const triangleCount = studioGeometryTriangleCount(mesh);
  if (vertexCount === 0 || triangleCount === 0) {
    return studioGeometryFail("empty-geometry", "압출할 면이 없습니다.");
  }
  const distance = Number.isFinite(params.distance) ? params.distance : 0;
  const capOriginal = params.capOriginal ?? true;
  const normals = mesh.normals ?? studioGeometryComputeVertexNormals(mesh);
  const boundary = studioGeometryBoundaryEdges(mesh);
  const outVertices = vertexCount * 2;
  const outTriangles = triangleCount + (capOriginal ? triangleCount : 0) + boundary.length * 2;
  if (outVertices > budgets.maxVertices || outTriangles > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `extrude → ${outVertices}v/${outTriangles}f`);
  }
  const positions = new Float32Array(outVertices * 3);
  const uvs = mesh.uvs ? new Float32Array(outVertices * 2) : null;
  for (let i = 0; i < vertexCount; i++) {
    positions[i * 3] = mesh.positions[i * 3] + normals[i * 3] * distance;
    positions[i * 3 + 1] = mesh.positions[i * 3 + 1] + normals[i * 3 + 1] * distance;
    positions[i * 3 + 2] = mesh.positions[i * 3 + 2] + normals[i * 3 + 2] * distance;
    const bottom = vertexCount + i;
    positions[bottom * 3] = mesh.positions[i * 3];
    positions[bottom * 3 + 1] = mesh.positions[i * 3 + 1];
    positions[bottom * 3 + 2] = mesh.positions[i * 3 + 2];
    if (uvs && mesh.uvs) {
      uvs[i * 2] = mesh.uvs[i * 2];
      uvs[i * 2 + 1] = mesh.uvs[i * 2 + 1];
      uvs[bottom * 2] = mesh.uvs[i * 2];
      uvs[bottom * 2 + 1] = mesh.uvs[i * 2 + 1];
    }
  }
  const indices = new Uint32Array(outTriangles * 3);
  let cursor = 0;
  for (let t = 0; t < triangleCount; t++) {
    indices[cursor++] = mesh.indices[t * 3];
    indices[cursor++] = mesh.indices[t * 3 + 1];
    indices[cursor++] = mesh.indices[t * 3 + 2];
  }
  if (capOriginal) {
    for (let t = 0; t < triangleCount; t++) {
      indices[cursor++] = mesh.indices[t * 3] + vertexCount;
      indices[cursor++] = mesh.indices[t * 3 + 2] + vertexCount;
      indices[cursor++] = mesh.indices[t * 3 + 1] + vertexCount;
    }
  }
  for (const [a, b] of boundary) {
    const topA = a;
    const topB = b;
    const bottomA = a + vertexCount;
    const bottomB = b + vertexCount;
    indices[cursor++] = topA;
    indices[cursor++] = bottomA;
    indices[cursor++] = bottomB;
    indices[cursor++] = topA;
    indices[cursor++] = bottomB;
    indices[cursor++] = topB;
  }
  const built = createStudioGeometryMesh({ positions, indices, normals: null, uvs }, budgets);
  if (!built.ok) return built;
  return studioGeometryOk({
    ...built.value,
    normals: studioGeometryComputeVertexNormals(built.value),
  });
}

// ---------------------------------------------------------------------------
// distribute points on faces
// ---------------------------------------------------------------------------

export interface StudioGeometryDistributeParams {
  readonly seed: number;
  /** 명시 포인트 수. 지정하면 density 는 무시된다. */
  readonly count?: number;
  /** 단위 면적당 포인트 수(count 미지정 시). */
  readonly density?: number;
}

export function studioGeometryDistributePointsOnFaces(
  mesh: StudioGeometryMesh,
  params: StudioGeometryDistributeParams,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryPoints> {
  const triangleCount = studioGeometryTriangleCount(mesh);
  if (triangleCount === 0) return studioGeometryFail("empty-geometry", "면이 없어 포인트를 못 뿌립니다.");
  const cumulative = new Float64Array(triangleCount);
  let total = 0;
  for (let t = 0; t < triangleCount; t++) {
    total += studioGeometryTriangleArea(mesh, t);
    cumulative[t] = total;
  }
  if (!(total > 0)) return studioGeometryFail("degenerate-input", "표면적이 0 이라 샘플할 수 없습니다.");
  const requested = Number.isFinite(params.count ?? NaN)
    ? Math.trunc(params.count as number)
    : Math.round(total * (Number.isFinite(params.density ?? NaN) ? (params.density as number) : 0));
  const count = studioGeometryClamp(requested, 0, budgets.maxVertices);
  if (count <= 0) return studioGeometryFail("invalid-parameter", "포인트 수가 0 이하입니다.");
  const random = createStudioGeometryRandom(params.seed);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const target = random.nextFloat() * total;
    const triangle = lowerBound(cumulative, target);
    const [wa, wb, wc] = studioGeometryRandomBarycentric(random);
    const ia = mesh.indices[triangle * 3] * 3;
    const ib = mesh.indices[triangle * 3 + 1] * 3;
    const ic = mesh.indices[triangle * 3 + 2] * 3;
    for (let axis = 0; axis < 3; axis++) {
      positions[i * 3 + axis] =
        mesh.positions[ia + axis] * wa + mesh.positions[ib + axis] * wb + mesh.positions[ic + axis] * wc;
    }
    const [nx, ny, nz] = studioGeometryFaceNormal(mesh, triangle);
    const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (length > 0) {
      normals[i * 3] = nx / length;
      normals[i * 3 + 1] = ny / length;
      normals[i * 3 + 2] = nz / length;
    } else {
      normals[i * 3 + 2] = 1;
    }
  }
  return createStudioGeometryPoints(positions, normals, budgets);
}

/** cumulative[i] >= target 인 최소 i(이진 탐색). 결정적이며 항상 유효 인덱스를 낸다. */
function lowerBound(cumulative: Float64Array, target: number): number {
  let low = 0;
  let high = cumulative.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] < target) low = mid + 1;
    else high = mid;
  }
  return low;
}

// ---------------------------------------------------------------------------
// instance on points
// ---------------------------------------------------------------------------

export interface StudioGeometryInstanceParams {
  readonly seed: number;
  readonly scale?: number;
  /** 0 이면 스케일 지터 없음. 0.3 이면 [0.7, 1.3) 배. */
  readonly scaleJitter?: number;
  readonly randomRotation?: boolean;
}

export function studioGeometryInstanceOnPoints(
  instance: StudioGeometryMesh,
  points: StudioGeometryPoints,
  params: StudioGeometryInstanceParams,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const instanceVertices = studioGeometryVertexCount(instance);
  const instanceTriangles = studioGeometryTriangleCount(instance);
  if (instanceVertices === 0 || instanceTriangles === 0) {
    return studioGeometryFail("empty-geometry", "인스턴스 메시가 비어 있습니다.");
  }
  const available = studioGeometryPointCount(points);
  if (available === 0) return studioGeometryFail("empty-geometry", "배치할 포인트가 없습니다.");
  const instanceCount = Math.min(available, budgets.maxInstances);
  const outVertices = instanceCount * instanceVertices;
  const outTriangles = instanceCount * instanceTriangles;
  if (outVertices > budgets.maxVertices || outTriangles > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `instance → ${outVertices}v/${outTriangles}f`);
  }
  const baseScale = Number.isFinite(params.scale ?? NaN) ? (params.scale as number) : 1;
  const jitter = studioGeometryClamp(
    Number.isFinite(params.scaleJitter ?? NaN) ? (params.scaleJitter as number) : 0,
    0,
    0.99
  );
  const randomRotation = params.randomRotation ?? false;
  const random = createStudioGeometryRandom(params.seed);
  const instanceNormals = instance.normals ?? studioGeometryComputeVertexNormals(instance);
  const positions = new Float32Array(outVertices * 3);
  const normals = new Float32Array(outVertices * 3);
  const uvs = instance.uvs ? new Float32Array(outVertices * 2) : null;
  const indices = new Uint32Array(outTriangles * 3);
  for (let p = 0; p < instanceCount; p++) {
    // 난수 소비 순서 고정: 회전 3개 → 스케일 1개. 플래그가 꺼져 있어도 순서 유지를 위해 뽑는다.
    const rx = randomRotation ? random.nextFloat() * TWO_PI : 0;
    const ry = randomRotation ? random.nextFloat() * TWO_PI : 0;
    const rz = randomRotation ? random.nextFloat() * TWO_PI : 0;
    const scale = jitter > 0 ? baseScale * random.nextRange(1 - jitter, 1 + jitter) : baseScale;
    const m = studioGeometryEulerMatrix([rx, ry, rz]);
    const ox = points.positions[p * 3];
    const oy = points.positions[p * 3 + 1];
    const oz = points.positions[p * 3 + 2];
    const vertexBase = p * instanceVertices;
    for (let i = 0; i < instanceVertices; i++) {
      const x = instance.positions[i * 3] * scale;
      const y = instance.positions[i * 3 + 1] * scale;
      const z = instance.positions[i * 3 + 2] * scale;
      const out = (vertexBase + i) * 3;
      positions[out] = m[0] * x + m[1] * y + m[2] * z + ox;
      positions[out + 1] = m[3] * x + m[4] * y + m[5] * z + oy;
      positions[out + 2] = m[6] * x + m[7] * y + m[8] * z + oz;
      const nx = instanceNormals[i * 3];
      const ny = instanceNormals[i * 3 + 1];
      const nz = instanceNormals[i * 3 + 2];
      normals[out] = m[0] * nx + m[1] * ny + m[2] * nz;
      normals[out + 1] = m[3] * nx + m[4] * ny + m[5] * nz;
      normals[out + 2] = m[6] * nx + m[7] * ny + m[8] * nz;
      if (uvs && instance.uvs) {
        uvs[(vertexBase + i) * 2] = instance.uvs[i * 2];
        uvs[(vertexBase + i) * 2 + 1] = instance.uvs[i * 2 + 1];
      }
    }
    for (let k = 0; k < instance.indices.length; k++) {
      indices[p * instance.indices.length + k] = instance.indices[k] + vertexBase;
    }
  }
  return createStudioGeometryMesh({ positions, indices, normals, uvs }, budgets);
}

// ---------------------------------------------------------------------------
// attribute math
// ---------------------------------------------------------------------------

export const STUDIO_GEOMETRY_ATTRIBUTE_MATH_OPS = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "minimum",
  "maximum",
  "dot",
  "length",
  "clamp",
  "mix",
] as const;

export type StudioGeometryAttributeMathOp = (typeof STUDIO_GEOMETRY_ATTRIBUTE_MATH_OPS)[number];

export function isStudioGeometryAttributeMathOp(
  value: unknown
): value is StudioGeometryAttributeMathOp {
  return (
    typeof value === "string" &&
    (STUDIO_GEOMETRY_ATTRIBUTE_MATH_OPS as readonly string[]).includes(value)
  );
}

/** 피연산자 — 속성 배열, 스칼라 상수(전 성분 브로드캐스트), 또는 vec3 상수(성분별). */
export type StudioGeometryOperand = StudioGeometryAttribute | StudioGeometryVec3 | number;

function isVec3Operand(operand: StudioGeometryOperand): operand is StudioGeometryVec3 {
  return Array.isArray(operand);
}

function operandComponent(
  operand: StudioGeometryOperand,
  element: number,
  component: number,
  itemSize: number
): number {
  if (typeof operand === "number") return operand;
  if (isVec3Operand(operand)) return operand[Math.min(component, 2)];
  if (operand.itemSize === 1) return operand.values[element];
  return operand.values[element * itemSize + component];
}

function operandLength(operand: StudioGeometryOperand): number {
  if (typeof operand === "number" || isVec3Operand(operand)) return Infinity;
  return operand.values.length / operand.itemSize;
}

function operandIsVec3Capable(operand: StudioGeometryOperand): boolean {
  if (typeof operand === "number" || isVec3Operand(operand)) return true;
  return operand.itemSize === 3;
}

export interface StudioGeometryAttributeMathInput {
  readonly a: StudioGeometryAttribute;
  readonly b?: StudioGeometryOperand;
  readonly c?: StudioGeometryOperand;
  readonly op: StudioGeometryAttributeMathOp;
}

/**
 * 속성 산술. 결과 도메인은 항상 a 의 도메인이고, itemSize 는 op 에 따라 결정된다
 * (dot/length 는 1, 나머지는 a 와 동일). 0 으로 나누면 0.
 */
export function studioGeometryAttributeMath(
  input: StudioGeometryAttributeMathInput
): StudioGeometryResult<StudioGeometryAttribute> {
  const { a, op } = input;
  const b = input.b ?? 0;
  const c = input.c ?? 0;
  const elements = a.values.length / a.itemSize;
  if (!Number.isInteger(elements)) {
    return studioGeometryFail("attribute-length-mismatch", `values=${a.values.length}, itemSize=${a.itemSize}`);
  }
  const needsB = op !== "length";
  if (needsB && operandLength(b) < elements) {
    return studioGeometryFail("attribute-length-mismatch", `b 의 원소 수가 a(${elements})보다 적습니다.`);
  }
  if ((op === "clamp" || op === "mix") && operandLength(c) < elements) {
    return studioGeometryFail("attribute-length-mismatch", `c 의 원소 수가 a(${elements})보다 적습니다.`);
  }
  if ((op === "dot" || op === "length") && a.itemSize !== 3) {
    return studioGeometryFail("input-type-mismatch", `${op} 은 vec3 속성만 받습니다.`);
  }
  if (op === "dot" && !operandIsVec3Capable(b)) {
    return studioGeometryFail("input-type-mismatch", "dot 의 두 번째 인자도 vec3 여야 합니다.");
  }
  const outItemSize: 1 | 3 = op === "dot" || op === "length" ? 1 : a.itemSize;
  const values = new Float32Array(elements * outItemSize);
  for (let e = 0; e < elements; e++) {
    if (op === "length") {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        const v = a.values[e * 3 + k];
        sum += v * v;
      }
      values[e] = Math.sqrt(sum);
      continue;
    }
    if (op === "dot") {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += a.values[e * 3 + k] * operandComponent(b, e, k, 3);
      values[e] = sum;
      continue;
    }
    for (let k = 0; k < outItemSize; k++) {
      const av = a.values[e * a.itemSize + k];
      const bv = operandComponent(b, e, k, a.itemSize);
      let result: number;
      switch (op) {
        case "add":
          result = av + bv;
          break;
        case "subtract":
          result = av - bv;
          break;
        case "multiply":
          result = av * bv;
          break;
        case "divide":
          result = bv === 0 ? 0 : av / bv;
          break;
        case "minimum":
          result = Math.min(av, bv);
          break;
        case "maximum":
          result = Math.max(av, bv);
          break;
        case "clamp": {
          const cv = operandComponent(c, e, k, a.itemSize);
          result = bv <= cv ? studioGeometryClamp(av, bv, cv) : studioGeometryClamp(av, cv, bv);
          break;
        }
        default: {
          const t = studioGeometryClamp(operandComponent(c, e, k, a.itemSize), 0, 1);
          result = av * (1 - t) + bv * t;
          break;
        }
      }
      values[e * outItemSize + k] = Number.isFinite(result) ? result : 0;
    }
  }
  return studioGeometryOk({ domain: a.domain, itemSize: outItemSize, values });
}

/** 메시 위치를 point 도메인 vec3 속성으로 본다(복사 없음 — 읽기 전용으로 다뤄야 한다). */
export function studioGeometryPositionAttribute(mesh: StudioGeometryMesh): StudioGeometryAttribute {
  return { domain: "point", itemSize: 3, values: mesh.positions };
}

/** point 도메인 vec3 속성을 위치로 되돌려 새 메시를 만든다. */
export function studioGeometryWithPositions(
  mesh: StudioGeometryMesh,
  attribute: StudioGeometryAttribute,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  if (attribute.domain !== "point" || attribute.itemSize !== 3) {
    return studioGeometryFail("input-type-mismatch", "위치는 point 도메인 vec3 속성이어야 합니다.");
  }
  if (attribute.values.length !== mesh.positions.length) {
    return studioGeometryFail(
      "attribute-length-mismatch",
      `속성=${attribute.values.length} != 위치=${mesh.positions.length}`
    );
  }
  const built = createStudioGeometryMesh(
    {
      positions: Float32Array.from(attribute.values),
      indices: Uint32Array.from(mesh.indices),
      normals: null,
      uvs: cloneOrNull(mesh.uvs),
    },
    budgets
  );
  if (!built.ok) return built;
  return studioGeometryOk({
    ...built.value,
    normals: studioGeometryComputeVertexNormals(built.value),
  });
}
