/**
 * 지오메트리 노드 — 메시 프리미티브(cube / uv-sphere / cylinder / grid).
 *
 * 기본 치수는 3D 배경 블록아웃 프리미티브(`studio-background-3d-primitives.ts` 의
 * `makeGeometry`)와 맞춰 두었다 — box 1³, sphere r=0.5(24×16), cylinder r=0.3 h=1(16),
 * plane 1×1. 그래서 노드로 만든 형태와 손으로 놓은 블록아웃이 같은 스케일로 섞인다.
 *
 * 각 프리미티브는 **닫힌 공식 카운트 함수**를 함께 내보낸다(`studioGeometryCubeCounts` 등).
 * 테스트는 실제 생성 결과를 이 공식과 대조하므로 "그냥 안 터졌다" 수준의 검증이 아니다.
 *
 * 위상 규약:
 *  - cube 는 면마다 정점을 분리한다(면 법선·면별 UV 를 위해). 그래서 정점 8개가 아니라
 *    6·(n+1)² 개이며, 고유 좌표만 모으면 정확히 8개(기본 n=1)가 된다.
 *  - uv-sphere 는 극에서 퇴화 삼각형을 생성하지 않는다(three.js 와 같은 규약).
 *  - cylinder 의 캡은 팬(fan) 이고, 캡을 끄면 옆면만 남는 열린 튜브가 된다.
 *  - grid 는 XY 평면(법선 +Z)에 놓인다.
 *
 * 삼각함수는 전부 `studioGeometryCos/Sin`(2^-20 양자화)을 통과한다 — 결정성 계약 참조.
 */

import {
  createStudioGeometryMesh,
  STUDIO_GEOMETRY_DEFAULT_BUDGETS,
  studioGeometryClamp,
  studioGeometryCos,
  studioGeometryFail,
  studioGeometrySin,
} from "./studio-geometry-nodes-mesh";

import type {
  StudioGeometryBudgets,
  StudioGeometryMesh,
  StudioGeometryResult,
} from "./studio-geometry-nodes-mesh";

const TWO_PI = Math.PI * 2;

/** 세그먼트 상한 — (n+1)² 폭발을 막는 실용 상한. */
export const STUDIO_GEOMETRY_MAX_SEGMENTS = 256;

export interface StudioGeometryCounts {
  readonly vertices: number;
  readonly triangles: number;
}

function clampSegments(value: number, min: number): number {
  if (!Number.isFinite(value)) return min;
  return studioGeometryClamp(Math.trunc(value), min, STUDIO_GEOMETRY_MAX_SEGMENTS);
}

function clampSize(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, 1_000);
}

// ---------------------------------------------------------------------------
// cube
// ---------------------------------------------------------------------------

export interface StudioGeometryCubeParams {
  readonly size?: number;
  readonly segments?: number;
}

/** 정점 6(n+1)², 삼각형 12n². */
export function studioGeometryCubeCounts(segments: number): StudioGeometryCounts {
  const n = clampSegments(segments, 1);
  return { vertices: 6 * (n + 1) * (n + 1), triangles: 12 * n * n };
}

interface PlaneFaceSpec {
  readonly u: 0 | 1 | 2;
  readonly v: 0 | 1 | 2;
  readonly w: 0 | 1 | 2;
  readonly uDir: 1 | -1;
  readonly vDir: 1 | -1;
  readonly wSign: 1 | -1;
}

const CUBE_FACES: readonly PlaneFaceSpec[] = [
  { u: 2, v: 1, w: 0, uDir: -1, vDir: -1, wSign: 1 },
  { u: 2, v: 1, w: 0, uDir: 1, vDir: -1, wSign: -1 },
  { u: 0, v: 2, w: 1, uDir: 1, vDir: 1, wSign: 1 },
  { u: 0, v: 2, w: 1, uDir: 1, vDir: -1, wSign: -1 },
  { u: 0, v: 1, w: 2, uDir: 1, vDir: -1, wSign: 1 },
  { u: 0, v: 1, w: 2, uDir: -1, vDir: -1, wSign: -1 },
];

export function studioGeometryCube(
  params: StudioGeometryCubeParams = {},
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const size = clampSize(params.size ?? 1, 1);
  const n = clampSegments(params.segments ?? 1, 1);
  const counts = studioGeometryCubeCounts(n);
  if (counts.vertices > budgets.maxVertices || counts.triangles > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `cube(${n}) → ${counts.vertices}v/${counts.triangles}f`);
  }
  const half = size / 2;
  const positions = new Float32Array(counts.vertices * 3);
  const normals = new Float32Array(counts.vertices * 3);
  const uvs = new Float32Array(counts.vertices * 2);
  const indices = new Uint32Array(counts.triangles * 3);
  let vertexCursor = 0;
  let indexCursor = 0;
  for (const face of CUBE_FACES) {
    const base = vertexCursor;
    for (let iy = 0; iy <= n; iy++) {
      for (let ix = 0; ix <= n; ix++) {
        const offset = vertexCursor * 3;
        positions[offset + face.u] = (ix / n - 0.5) * size * face.uDir;
        positions[offset + face.v] = (iy / n - 0.5) * size * face.vDir;
        positions[offset + face.w] = half * face.wSign;
        normals[offset + face.u] = 0;
        normals[offset + face.v] = 0;
        normals[offset + face.w] = face.wSign;
        uvs[vertexCursor * 2] = ix / n;
        uvs[vertexCursor * 2 + 1] = 1 - iy / n;
        vertexCursor += 1;
      }
    }
    const stride = n + 1;
    for (let iy = 0; iy < n; iy++) {
      for (let ix = 0; ix < n; ix++) {
        const a = base + ix + stride * iy;
        const b = base + ix + stride * (iy + 1);
        const c = base + (ix + 1) + stride * (iy + 1);
        const d = base + (ix + 1) + stride * iy;
        indices[indexCursor++] = a;
        indices[indexCursor++] = b;
        indices[indexCursor++] = d;
        indices[indexCursor++] = b;
        indices[indexCursor++] = c;
        indices[indexCursor++] = d;
      }
    }
  }
  return createStudioGeometryMesh({ positions, indices, normals, uvs }, budgets);
}

// ---------------------------------------------------------------------------
// uv sphere
// ---------------------------------------------------------------------------

export interface StudioGeometrySphereParams {
  readonly radius?: number;
  /** 경도 분할(기본 24). 최소 3. */
  readonly segments?: number;
  /** 위도 분할(기본 16). 최소 2. */
  readonly rings?: number;
}

/** 정점 (segments+1)(rings+1), 삼각형 segments·(2·rings − 2). */
export function studioGeometrySphereCounts(segments: number, rings: number): StudioGeometryCounts {
  const s = clampSegments(segments, 3);
  const r = clampSegments(rings, 2);
  return { vertices: (s + 1) * (r + 1), triangles: s * (2 * r - 2) };
}

export function studioGeometrySphere(
  params: StudioGeometrySphereParams = {},
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const radius = clampSize(params.radius ?? 0.5, 0.5);
  const s = clampSegments(params.segments ?? 24, 3);
  const r = clampSegments(params.rings ?? 16, 2);
  const counts = studioGeometrySphereCounts(s, r);
  if (counts.vertices > budgets.maxVertices || counts.triangles > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `sphere(${s},${r}) → ${counts.vertices}v`);
  }
  const positions = new Float32Array(counts.vertices * 3);
  const normals = new Float32Array(counts.vertices * 3);
  const uvs = new Float32Array(counts.vertices * 2);
  const indices = new Uint32Array(counts.triangles * 3);
  let cursor = 0;
  for (let iy = 0; iy <= r; iy++) {
    const v = iy / r;
    const phi = v * Math.PI;
    const sinPhi = studioGeometrySin(phi);
    const cosPhi = studioGeometryCos(phi);
    for (let ix = 0; ix <= s; ix++) {
      const u = ix / s;
      const theta = u * TWO_PI;
      const nx = -studioGeometryCos(theta) * sinPhi;
      const ny = cosPhi;
      const nz = studioGeometrySin(theta) * sinPhi;
      positions[cursor * 3] = radius * nx;
      positions[cursor * 3 + 1] = radius * ny;
      positions[cursor * 3 + 2] = radius * nz;
      normals[cursor * 3] = nx;
      normals[cursor * 3 + 1] = ny;
      normals[cursor * 3 + 2] = nz;
      uvs[cursor * 2] = u;
      uvs[cursor * 2 + 1] = 1 - v;
      cursor += 1;
    }
  }
  const stride = s + 1;
  let indexCursor = 0;
  for (let iy = 0; iy < r; iy++) {
    for (let ix = 0; ix < s; ix++) {
      const a = ix + stride * iy;
      const b = ix + stride * (iy + 1);
      const c = ix + 1 + stride * (iy + 1);
      const d = ix + 1 + stride * iy;
      if (iy !== 0) {
        indices[indexCursor++] = a;
        indices[indexCursor++] = b;
        indices[indexCursor++] = d;
      }
      if (iy !== r - 1) {
        indices[indexCursor++] = b;
        indices[indexCursor++] = c;
        indices[indexCursor++] = d;
      }
    }
  }
  return createStudioGeometryMesh({ positions, indices, normals, uvs }, budgets);
}

// ---------------------------------------------------------------------------
// cylinder
// ---------------------------------------------------------------------------

export interface StudioGeometryCylinderParams {
  readonly radius?: number;
  readonly height?: number;
  readonly segments?: number;
  readonly caps?: boolean;
}

/** 캡 포함 시 정점 4n+6 / 삼각형 4n, 캡 제외 시 정점 2n+2 / 삼각형 2n. */
export function studioGeometryCylinderCounts(segments: number, caps: boolean): StudioGeometryCounts {
  const n = clampSegments(segments, 3);
  const side = { vertices: 2 * (n + 1), triangles: 2 * n };
  if (!caps) return side;
  return { vertices: side.vertices + 2 * (n + 2), triangles: side.triangles + 2 * n };
}

export function studioGeometryCylinder(
  params: StudioGeometryCylinderParams = {},
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const radius = clampSize(params.radius ?? 0.3, 0.3);
  const height = clampSize(params.height ?? 1, 1);
  const n = clampSegments(params.segments ?? 16, 3);
  const caps = params.caps ?? true;
  const counts = studioGeometryCylinderCounts(n, caps);
  if (counts.vertices > budgets.maxVertices || counts.triangles > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `cylinder(${n}) → ${counts.vertices}v`);
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const half = height / 2;
  for (let iy = 0; iy <= 1; iy++) {
    for (let ix = 0; ix <= n; ix++) {
      const u = ix / n;
      const theta = u * TWO_PI;
      const sx = studioGeometrySin(theta);
      const cz = studioGeometryCos(theta);
      positions.push(radius * sx, iy === 0 ? half : -half, radius * cz);
      normals.push(sx, 0, cz);
      uvs.push(u, 1 - iy);
    }
  }
  const stride = n + 1;
  for (let ix = 0; ix < n; ix++) {
    const a = ix;
    const b = ix + stride;
    const c = ix + 1 + stride;
    const d = ix + 1;
    indices.push(a, b, d, b, c, d);
  }
  if (caps) {
    for (const top of [true, false]) {
      const y = top ? half : -half;
      const sign = top ? 1 : -1;
      const center = positions.length / 3;
      positions.push(0, y, 0);
      normals.push(0, sign, 0);
      uvs.push(0.5, 0.5);
      const ringStart = positions.length / 3;
      for (let ix = 0; ix <= n; ix++) {
        const theta = (ix / n) * TWO_PI;
        const sx = studioGeometrySin(theta);
        const cz = studioGeometryCos(theta);
        positions.push(radius * sx, y, radius * cz);
        normals.push(0, sign, 0);
        uvs.push(sx * 0.5 + 0.5, cz * 0.5 * sign + 0.5);
      }
      for (let ix = 0; ix < n; ix++) {
        // 링은 (r·sinθ, y, r·cosθ) 라 θ 증가 방향이 +Y 에서 내려다볼 때 시계 방향이다.
        // 따라서 위 캡(법선 +Y)은 θ 증가 순서, 아래 캡(법선 −Y)은 역순이어야 면 방향이
        // 저장된 정점 법선과 일치한다. 반대로 감으면 두 캡이 안쪽을 보게 되어
        // 부호 있는 부피가 π r² h 가 아니라 그 1/3 로 떨어진다(적대 검증에서 실측).
        if (top) indices.push(center, ringStart + ix, ringStart + ix + 1);
        else indices.push(center, ringStart + ix + 1, ringStart + ix);
      }
    }
  }
  return createStudioGeometryMesh(
    {
      positions: new Float32Array(positions),
      indices: new Uint32Array(indices),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
    },
    budgets
  );
}

// ---------------------------------------------------------------------------
// grid (XY 평면, 법선 +Z)
// ---------------------------------------------------------------------------

export interface StudioGeometryGridParams {
  readonly sizeX?: number;
  readonly sizeY?: number;
  readonly segmentsX?: number;
  readonly segmentsY?: number;
}

/** 정점 (nx+1)(ny+1), 삼각형 2·nx·ny. */
export function studioGeometryGridCounts(segmentsX: number, segmentsY: number): StudioGeometryCounts {
  const nx = clampSegments(segmentsX, 1);
  const ny = clampSegments(segmentsY, 1);
  return { vertices: (nx + 1) * (ny + 1), triangles: 2 * nx * ny };
}

export function studioGeometryGrid(
  params: StudioGeometryGridParams = {},
  budgets: StudioGeometryBudgets = STUDIO_GEOMETRY_DEFAULT_BUDGETS
): StudioGeometryResult<StudioGeometryMesh> {
  const sizeX = clampSize(params.sizeX ?? 1, 1);
  const sizeY = clampSize(params.sizeY ?? 1, 1);
  const nx = clampSegments(params.segmentsX ?? 1, 1);
  const ny = clampSegments(params.segmentsY ?? 1, 1);
  const counts = studioGeometryGridCounts(nx, ny);
  if (counts.vertices > budgets.maxVertices || counts.triangles > budgets.maxTriangles) {
    return studioGeometryFail("budget-exceeded", `grid(${nx},${ny}) → ${counts.vertices}v`);
  }
  const positions = new Float32Array(counts.vertices * 3);
  const normals = new Float32Array(counts.vertices * 3);
  const uvs = new Float32Array(counts.vertices * 2);
  const indices = new Uint32Array(counts.triangles * 3);
  let cursor = 0;
  for (let iy = 0; iy <= ny; iy++) {
    for (let ix = 0; ix <= nx; ix++) {
      positions[cursor * 3] = (ix / nx - 0.5) * sizeX;
      positions[cursor * 3 + 1] = (iy / ny - 0.5) * sizeY;
      positions[cursor * 3 + 2] = 0;
      normals[cursor * 3 + 2] = 1;
      uvs[cursor * 2] = ix / nx;
      uvs[cursor * 2 + 1] = iy / ny;
      cursor += 1;
    }
  }
  const stride = nx + 1;
  let indexCursor = 0;
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = ix + stride * iy;
      const b = ix + stride * (iy + 1);
      const c = ix + 1 + stride * (iy + 1);
      const d = ix + 1 + stride * iy;
      indices[indexCursor++] = a;
      indices[indexCursor++] = d;
      indices[indexCursor++] = b;
      indices[indexCursor++] = b;
      indices[indexCursor++] = d;
      indices[indexCursor++] = c;
    }
  }
  return createStudioGeometryMesh({ positions, indices, normals, uvs }, budgets);
}
