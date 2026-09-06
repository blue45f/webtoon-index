/**
 * 지오메트리 노드 — 메시 데이터 모델 (순수 코어, 의존 0).
 *
 * 이 서브시스템은 **블렌더 지오메트리 노드의 패리티가 아니다.** 필드(Field)/익명 속성,
 * 시뮬레이션 존, 커브·볼륨·SDF, 노드 그룹, UV 언랩, 머티리얼 할당은 전부 없다.
 * 여기 있는 것은 "웹툰 배경 블록아웃을 절차적으로 조립"하는 데 필요한 최소 삼각형 메시
 * 모델과 그 위에 얹은 노드 그래프뿐이다.
 *
 * ## 데이터 모델
 * - 삼각형 인덱스 메시 1종(`StudioGeometryMesh`)과 포인트 클라우드 1종(`StudioGeometryPoints`).
 * - 속성 도메인은 point/face 두 가지만. **corner(면-정점) 도메인은 비지원**이라
 *   면마다 다른 UV/노멀이 필요하면 정점을 분리해서 넣어야 한다(프리미티브는 이미 분리해 둔다).
 * - 좌표는 전부 Float32Array. 상위 렌더러 계약(`StudioBg3dCanonicalGeometryPayload`)과
 *   같은 표현이라 `toStudioBg3dCanonicalGeometryPayload()` 한 번으로 3D 배경 씬에 넘길 수 있다.
 *
 * ## 결정성 계약 (하드)
 * 같은 입력 ⇒ 바이트 동일 출력. 이를 위해:
 * 1. `Math.random()`/`Date.now()` 를 **쓰지 않는다**(시드는 전부 명시 인자).
 * 2. ECMAScript 는 `Math.sin`/`Math.cos` 의 비트 재현성을 보장하지 않는다(구현 근사 허용).
 *    그래서 **삼각함수 출력만** `STUDIO_GEOMETRY_TRIG_QUANTUM = 2^-20` 격자로 반올림한 뒤
 *    쓴다(`studioGeometryCos`/`studioGeometrySin`). 단위 스케일에서 오차 약 1e-6.
 *    이후 연산은 순수 IEEE754 +,-,*,/ 라 엔진과 무관하게 비트 동일하다.
 *    잔여 리스크: 참값이 양자 경계(±2^-21)에 1e-16 이내로 붙는 각도에서는 엔진에 따라
 *    1 LSB 가 갈릴 수 있다 — 구조적으로 제거 불가능하며 여기 명시해 둔다.
 *    `Math.sqrt` 는 (스펙상 "구현 근사"지만) 주류 엔진 전부 IEEE754 정확 반올림 하드웨어
 *    명령이라 양자화하지 않는다.
 * 3. 반복은 전부 인덱스 순회. `Set`/`Map` 순회는 삽입 순서라 결정적이지만, 정렬이 필요한
 *    곳(사이클 멤버 등)은 명시 정렬한다.
 *
 * ## 실패 규약
 * 엔진은 예외를 던지지 않는다. 모든 경계 위반은 `StudioGeometryResult` 의
 * `{ ok:false, code, detail }` 로 수렴한다(스튜디오 나머지 순수 엔진과 동일 관례).
 */

import type {
  StudioBg3dCanonicalGeometryAttribute,
  StudioBg3dCanonicalGeometryPayload,
} from "./bg3d/studio-bg3d-geometry-worker-protocol";

// ---------------------------------------------------------------------------
// 예산 · 상수
// ---------------------------------------------------------------------------

/** 대화형 기본 정점 상한. 워커 프로토콜의 4M 은 임포트 상한이라 노드 그래프엔 과하다. */
export const STUDIO_GEOMETRY_MAX_VERTICES = 512_000;
/** 대화형 기본 삼각형 상한. */
export const STUDIO_GEOMETRY_MAX_TRIANGLES = 1_000_000;
/** instance-on-points 인스턴스 상한 — three 인스턴싱 배치 상한(1_024)과 동일. */
export const STUDIO_GEOMETRY_MAX_INSTANCES = 1_024;
/** 좌표 절댓값 상한 — 배경 씬 월드 상한(10_000)과 동일. */
export const STUDIO_GEOMETRY_MAX_WORLD_COORDINATE = 10_000;

/** 삼각함수 출력 양자 — 결정성 계약(모듈 독스트링 2번) 참조. */
export const STUDIO_GEOMETRY_TRIG_QUANTUM = 2 ** -20;
const TRIG_SCALE = 2 ** 20;

/** 정점 병합/투영 비교용 기본 양자(1e-5). 좌표를 이 격자로 반올림해 키를 만든다. */
export const STUDIO_GEOMETRY_WELD_QUANTUM = 1e-5;

export interface StudioGeometryBudgets {
  readonly maxVertices: number;
  readonly maxTriangles: number;
  readonly maxInstances: number;
}

export const STUDIO_GEOMETRY_DEFAULT_BUDGETS: StudioGeometryBudgets = Object.freeze({
  maxVertices: STUDIO_GEOMETRY_MAX_VERTICES,
  maxTriangles: STUDIO_GEOMETRY_MAX_TRIANGLES,
  maxInstances: STUDIO_GEOMETRY_MAX_INSTANCES,
});

// ---------------------------------------------------------------------------
// 결과 타입
// ---------------------------------------------------------------------------

export type StudioGeometryFailureCode =
  | "attribute-length-mismatch"
  | "boolean-backend-failed"
  | "boolean-backend-missing"
  | "boolean-empty"
  | "budget-exceeded"
  | "coplanar-mismatch"
  | "degenerate-input"
  | "empty-geometry"
  | "index-out-of-range"
  | "input-type-mismatch"
  | "invalid-index-count"
  | "invalid-parameter"
  | "invalid-position-count"
  | "missing-input"
  | "non-finite"
  | "non-planar"
  | "open-boundary"
  | "triangulation-failed"
  | "unsupported-operation";

export type StudioGeometryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: StudioGeometryFailureCode; readonly detail: string };

export function studioGeometryOk<T>(value: T): StudioGeometryResult<T> {
  return { ok: true, value };
}

export function studioGeometryFail<T>(
  code: StudioGeometryFailureCode,
  detail: string
): StudioGeometryResult<T> {
  return { ok: false, code, detail };
}

// ---------------------------------------------------------------------------
// 결정적 수치 유틸
// ---------------------------------------------------------------------------

/** 삼각함수 출력 양자화 — 엔진 간 비트 동일성을 위한 유일한 장치. */
export function studioGeometryQuantizeTrig(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * TRIG_SCALE) / TRIG_SCALE;
}

export function studioGeometryCos(radians: number): number {
  return studioGeometryQuantizeTrig(Math.cos(radians));
}

export function studioGeometrySin(radians: number): number {
  return studioGeometryQuantizeTrig(Math.sin(radians));
}

export function studioGeometryClamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

// ---------------------------------------------------------------------------
// 메시 · 포인트 타입
// ---------------------------------------------------------------------------

/**
 * 삼각형 인덱스 메시. positions/normals 는 3-컴포넌트, uvs 는 2-컴포넌트 평탄 배열.
 * normals/uvs 는 없으면 null(있는 경우 길이는 정점 수와 반드시 정합).
 */
export interface StudioGeometryMesh {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly normals: Float32Array | null;
  readonly uvs: Float32Array | null;
}

/** 포인트 클라우드 — distribute-points-on-faces 출력, instance-on-points 입력. */
export interface StudioGeometryPoints {
  readonly positions: Float32Array;
  /** 샘플된 면의 법선(있으면). 인스턴스 정렬에 쓰인다. */
  readonly normals: Float32Array | null;
}

/** point/face 도메인 스칼라·벡터 속성 — attribute math 대상. */
export interface StudioGeometryAttribute {
  readonly domain: "face" | "point";
  readonly itemSize: 1 | 3;
  readonly values: Float32Array;
}

export function studioGeometryVertexCount(mesh: StudioGeometryMesh): number {
  return mesh.positions.length / 3;
}

export function studioGeometryTriangleCount(mesh: StudioGeometryMesh): number {
  return mesh.indices.length / 3;
}

export function studioGeometryPointCount(points: StudioGeometryPoints): number {
  return points.positions.length / 3;
}

export function studioGeometryEmptyMesh(): StudioGeometryMesh {
  return { positions: new Float32Array(0), indices: new Uint32Array(0), normals: null, uvs: null };
}

/** 메시 바이트 사용량 — 메모 캐시 LRU 예산 계산용. */
export function studioGeometryMeshByteLength(mesh: StudioGeometryMesh): number {
  return (
    mesh.positions.byteLength +
    mesh.indices.byteLength +
    (mesh.normals?.byteLength ?? 0) +
    (mesh.uvs?.byteLength ?? 0)
  );
}

// ---------------------------------------------------------------------------
// 검증 · 생성
// ---------------------------------------------------------------------------

export interface StudioGeometryMeshInput {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly normals?: Float32Array | null;
  readonly uvs?: Float32Array | null;
}

/**
 * 메시를 검증해서 만든다. 검사 항목:
 *  - positions 길이가 3의 배수, indices 길이가 3의 배수
 *  - 모든 좌표가 유한하고 월드 상한 이내
 *  - 모든 인덱스가 정점 범위 안
 *  - normals/uvs 길이가 정점 수와 정합
 *  - 예산(정점/삼각형) 이내
 */
export function createStudioGeometryMesh(
  input: StudioGeometryMeshInput,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const { positions, indices } = input;
  if (positions.length % 3 !== 0) {
    return studioGeometryFail("invalid-position-count", `positions=${positions.length} 은 3의 배수가 아닙니다.`);
  }
  if (indices.length % 3 !== 0) {
    return studioGeometryFail("invalid-index-count", `indices=${indices.length} 은 3의 배수가 아닙니다.`);
  }
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;
  if (vertexCount > budgets.maxVertices) {
    return studioGeometryFail("budget-exceeded", `정점 ${vertexCount} > 상한 ${budgets.maxVertices}`);
  }
  if (triangleCount > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `삼각형 ${triangleCount} > 상한 ${budgets.maxTriangles}`);
  }
  for (let i = 0; i < positions.length; i++) {
    const v = positions[i];
    if (!Number.isFinite(v)) {
      return studioGeometryFail("non-finite", `positions[${i}] 가 유한수가 아닙니다.`);
    }
    if (v > STUDIO_GEOMETRY_MAX_WORLD_COORDINATE || v < -STUDIO_GEOMETRY_MAX_WORLD_COORDINATE) {
      return studioGeometryFail("budget-exceeded", `positions[${i}]=${v} 가 월드 상한을 넘습니다.`);
    }
  }
  for (let i = 0; i < indices.length; i++) {
    const index = indices[i];
    if (!Number.isInteger(index) || index < 0 || index >= vertexCount) {
      return studioGeometryFail("index-out-of-range", `indices[${i}]=${index} (정점 수 ${vertexCount})`);
    }
  }
  const normals = input.normals ?? null;
  if (normals && normals.length !== positions.length) {
    return studioGeometryFail(
      "attribute-length-mismatch",
      `normals=${normals.length} != positions=${positions.length}`
    );
  }
  const uvs = input.uvs ?? null;
  if (uvs && uvs.length !== vertexCount * 2) {
    return studioGeometryFail("attribute-length-mismatch", `uvs=${uvs.length} != ${vertexCount * 2}`);
  }
  if (normals) {
    for (let i = 0; i < normals.length; i++) {
      if (!Number.isFinite(normals[i])) {
        return studioGeometryFail("non-finite", `normals[${i}] 가 유한수가 아닙니다.`);
      }
    }
  }
  if (uvs) {
    for (let i = 0; i < uvs.length; i++) {
      if (!Number.isFinite(uvs[i])) {
        return studioGeometryFail("non-finite", `uvs[${i}] 가 유한수가 아닙니다.`);
      }
    }
  }
  return studioGeometryOk({ positions, indices, normals, uvs });
}

export function createStudioGeometryPoints(
  positions: Float32Array,
  normals: Float32Array | null,
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryPoints> {
  if (positions.length % 3 !== 0) {
    return studioGeometryFail("invalid-position-count", `positions=${positions.length} 은 3의 배수가 아닙니다.`);
  }
  if (positions.length / 3 > budgets.maxVertices) {
    return studioGeometryFail("budget-exceeded", `포인트 ${positions.length / 3} > 상한 ${budgets.maxVertices}`);
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      return studioGeometryFail("non-finite", `positions[${i}] 가 유한수가 아닙니다.`);
    }
  }
  if (normals && normals.length !== positions.length) {
    return studioGeometryFail(
      "attribute-length-mismatch",
      `normals=${normals.length} != positions=${positions.length}`
    );
  }
  return studioGeometryOk({ positions, normals });
}

// ---------------------------------------------------------------------------
// 기하 유틸
// ---------------------------------------------------------------------------

export interface StudioGeometryBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export function studioGeometryMeshBounds(mesh: StudioGeometryMesh): StudioGeometryBounds | null {
  const count = studioGeometryVertexCount(mesh);
  if (count === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** 삼각형 t 의 (정규화되지 않은) 면 법선 = 두 변의 외적. 크기는 면적의 2배. */
export function studioGeometryFaceNormal(
  mesh: StudioGeometryMesh,
  triangle: number
): [number, number, number] {
  const ia = mesh.indices[triangle * 3] * 3;
  const ib = mesh.indices[triangle * 3 + 1] * 3;
  const ic = mesh.indices[triangle * 3 + 2] * 3;
  const p = mesh.positions;
  const ux = p[ib] - p[ia];
  const uy = p[ib + 1] - p[ia + 1];
  const uz = p[ib + 2] - p[ia + 2];
  const vx = p[ic] - p[ia];
  const vy = p[ic + 1] - p[ia + 1];
  const vz = p[ic + 2] - p[ia + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/** 삼각형 면적 = |외적| / 2. */
export function studioGeometryTriangleArea(mesh: StudioGeometryMesh, triangle: number): number {
  const [nx, ny, nz] = studioGeometryFaceNormal(mesh, triangle);
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

export function studioGeometrySurfaceArea(mesh: StudioGeometryMesh): number {
  let total = 0;
  const triangles = studioGeometryTriangleCount(mesh);
  for (let t = 0; t < triangles; t++) total += studioGeometryTriangleArea(mesh, t);
  return total;
}

/**
 * 면적 가중 정점 법선 재계산. 면 법선을 정규화하지 않고 누산하므로 큰 면이 더 큰 가중치를
 * 갖는다(three.js `computeVertexNormals` 와 같은 규약). 길이 0 인 법선은 [0,0,1] 로 둔다.
 */
export function studioGeometryComputeVertexNormals(mesh: StudioGeometryMesh): Float32Array {
  const vertexCount = studioGeometryVertexCount(mesh);
  const normals = new Float32Array(vertexCount * 3);
  const triangles = studioGeometryTriangleCount(mesh);
  for (let t = 0; t < triangles; t++) {
    const [nx, ny, nz] = studioGeometryFaceNormal(mesh, t);
    for (let k = 0; k < 3; k++) {
      const base = mesh.indices[t * 3 + k] * 3;
      normals[base] += nx;
      normals[base + 1] += ny;
      normals[base + 2] += nz;
    }
  }
  for (let i = 0; i < vertexCount; i++) {
    const x = normals[i * 3];
    const y = normals[i * 3 + 1];
    const z = normals[i * 3 + 2];
    const length = Math.sqrt(x * x + y * y + z * z);
    if (length > 0) {
      normals[i * 3] = x / length;
      normals[i * 3 + 1] = y / length;
      normals[i * 3 + 2] = z / length;
    } else {
      normals[i * 3] = 0;
      normals[i * 3 + 1] = 0;
      normals[i * 3 + 2] = 1;
    }
  }
  return normals;
}

/** 법선이 없으면 계산해서 채운 메시를 돌려준다(있으면 그대로). */
export function studioGeometryWithVertexNormals(mesh: StudioGeometryMesh): StudioGeometryMesh {
  if (mesh.normals) return mesh;
  return { ...mesh, normals: studioGeometryComputeVertexNormals(mesh) };
}

function weldKey(x: number, y: number, z: number, quantum: number): string {
  const qx = Math.round(x / quantum);
  const qy = Math.round(y / quantum);
  const qz = Math.round(z / quantum);
  return `${qx},${qy},${qz}`;
}

export interface StudioGeometryWeldResult {
  readonly mesh: StudioGeometryMesh;
  /** 원본 정점 → 병합 후 정점 인덱스. 경계 루프 추출 등에서 재사용. */
  readonly remap: Uint32Array;
}

/**
 * 좌표 양자화 키로 정점을 병합한다. 첫 등장 정점의 속성을 대표로 쓰고(평균 아님 — 결정적),
 * 퇴화 삼각형(같은 정점 2개 이상)은 버린다. 위치 기준이라 UV 심(seam)은 합쳐진다는 점에 유의.
 */
export function studioGeometryMergeVertices(
  mesh: StudioGeometryMesh,
  quantum: number = STUDIO_GEOMETRY_WELD_QUANTUM
): StudioGeometryWeldResult {
  const vertexCount = studioGeometryVertexCount(mesh);
  const remap = new Uint32Array(vertexCount);
  const lookup = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] | null = mesh.normals ? [] : null;
  const uvs: number[] | null = mesh.uvs ? [] : null;
  for (let i = 0; i < vertexCount; i++) {
    const x = mesh.positions[i * 3];
    const y = mesh.positions[i * 3 + 1];
    const z = mesh.positions[i * 3 + 2];
    const key = weldKey(x, y, z, quantum);
    const existing = lookup.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
      continue;
    }
    const next = positions.length / 3;
    lookup.set(key, next);
    remap[i] = next;
    positions.push(x, y, z);
    if (normals && mesh.normals) {
      normals.push(mesh.normals[i * 3], mesh.normals[i * 3 + 1], mesh.normals[i * 3 + 2]);
    }
    if (uvs && mesh.uvs) uvs.push(mesh.uvs[i * 2], mesh.uvs[i * 2 + 1]);
  }
  const indices: number[] = [];
  const triangles = studioGeometryTriangleCount(mesh);
  for (let t = 0; t < triangles; t++) {
    const a = remap[mesh.indices[t * 3]];
    const b = remap[mesh.indices[t * 3 + 1]];
    const c = remap[mesh.indices[t * 3 + 2]];
    if (a === b || b === c || a === c) continue;
    indices.push(a, b, c);
  }
  return {
    mesh: {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      normals: normals ? new Float32Array(normals) : null,
      uvs: uvs ? new Float32Array(uvs) : null,
    },
    remap,
  };
}

/**
 * 경계 엣지(정확히 한 삼각형에만 속하는 엣지) 목록. 방향은 그 삼각형의 winding 을 따른다.
 * 닫힌 메시면 빈 배열. extrude 의 측면 생성과 boolean 의 링 추출이 공유한다.
 */
export function studioGeometryBoundaryEdges(mesh: StudioGeometryMesh): [number, number][] {
  const vertexCount = studioGeometryVertexCount(mesh);
  const seen = new Map<number, number>();
  const directed: [number, number][] = [];
  const triangles = studioGeometryTriangleCount(mesh);
  for (let t = 0; t < triangles; t++) {
    for (let k = 0; k < 3; k++) {
      const a = mesh.indices[t * 3 + k];
      const b = mesh.indices[t * 3 + ((k + 1) % 3)];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * vertexCount + hi;
      seen.set(key, (seen.get(key) ?? 0) + 1);
      directed.push([a, b]);
    }
  }
  const boundary: [number, number][] = [];
  for (const [a, b] of directed) {
    const key = Math.min(a, b) * vertexCount + Math.max(a, b);
    if (seen.get(key) === 1) boundary.push([a, b]);
  }
  return boundary;
}

// ---------------------------------------------------------------------------
// 렌더러 브리지
// ---------------------------------------------------------------------------

/**
 * `StudioBg3dCanonicalGeometryPayload` 로 변환 — 3D 배경 임포트 경로가 이미 소비하는 형식이라
 * (`studio-bg3d-model-import.ts` 의 `new BufferGeometry()` 분기) 추가 배선 없이 렌더된다.
 *
 * `format` 은 파일 출처 태그라 절차적 메시에는 의미가 없다. 속성이 자유로운 "ply" 로 고정한다.
 * 속성 순서는 검증기가 요구하는 position → normal → uv 순서를 지킨다.
 */
export function toStudioBg3dCanonicalGeometryPayload(
  mesh: StudioGeometryMesh
): StudioGeometryResult<StudioBg3dCanonicalGeometryPayload> {
  const vertexCount = studioGeometryVertexCount(mesh);
  const triangleCount = studioGeometryTriangleCount(mesh);
  if (vertexCount === 0 || triangleCount === 0) {
    return studioGeometryFail("empty-geometry", "정점 또는 삼각형이 없어 렌더 페이로드로 못 바꿉니다.");
  }
  const normals = mesh.normals ?? studioGeometryComputeVertexNormals(mesh);
  const attributes: StudioBg3dCanonicalGeometryAttribute[] = [
    {
      name: "position",
      itemSize: 3,
      count: vertexCount,
      normalized: false,
      arrayType: "float32",
      buffer: sliceBuffer(mesh.positions),
    },
    {
      name: "normal",
      itemSize: 3,
      count: vertexCount,
      normalized: false,
      arrayType: "float32",
      buffer: sliceBuffer(normals),
    },
  ];
  if (mesh.uvs) {
    attributes.push({
      name: "uv",
      itemSize: 2,
      count: vertexCount,
      normalized: false,
      arrayType: "float32",
      buffer: sliceBuffer(mesh.uvs),
    });
  }
  const indexBuffer = sliceIndexBuffer(mesh.indices);
  let byteLength = indexBuffer.byteLength;
  for (const attribute of attributes) byteLength += attribute.buffer.byteLength;
  return studioGeometryOk({
    format: "ply",
    kind: "mesh",
    vertexCount,
    triangleCount,
    byteLength,
    attributes,
    index: { count: mesh.indices.length, arrayType: "uint32", buffer: indexBuffer },
  });
}

function sliceBuffer(array: Float32Array): ArrayBuffer {
  return array.buffer.slice(
    array.byteOffset,
    array.byteOffset + array.byteLength
  ) as ArrayBuffer;
}

function sliceIndexBuffer(array: Uint32Array): ArrayBuffer {
  return array.buffer.slice(
    array.byteOffset,
    array.byteOffset + array.byteLength
  ) as ArrayBuffer;
}
