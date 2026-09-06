/**
 * 적대적 검증 — 기존 8개 스위트가 **주장하지 않은** 성질을 독립적으로 측정한다.
 *
 * 주 관심사: 프리미티브의 **와인딩(면 방향)** 이 저장된 정점 법선과 일치하는가.
 * 기존 테스트는 정점/삼각형 개수·좌표·법선 값만 보고, 인덱스 순서가 만드는 기하학적
 * 면 방향은 한 번도 대조하지 않는다. 개수가 맞아도 면이 뒤집혀 있으면 backface culling
 * 에서 사라지고 라이팅이 반대로 간다.
 */

import { describe, expect, it } from "vitest";

import {
  studioGeometryBoundaryEdges,
  studioGeometryFaceNormal,
  studioGeometryMergeVertices,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";
import {
  studioGeometryExtrude,
  studioGeometryTransform,
} from "./studio-geometry-nodes-ops";
import {
  studioGeometryCube,
  studioGeometryCylinder,
  studioGeometryGrid,
  studioGeometrySphere,
} from "./studio-geometry-nodes-primitives";

import type { StudioGeometryMesh, StudioGeometryResult } from "./studio-geometry-nodes-mesh";

function unwrap(result: StudioGeometryResult<StudioGeometryMesh>): StudioGeometryMesh {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.value;
}

/** 발산 정리 부호 있는 부피 — 바깥 방향으로 일관 와인딩된 닫힌 메시면 양수. */
function signedVolume(mesh: StudioGeometryMesh): number {
  let total = 0;
  const triangles = studioGeometryTriangleCount(mesh);
  for (let t = 0; t < triangles; t++) {
    const ia = mesh.indices[t * 3] * 3;
    const ib = mesh.indices[t * 3 + 1] * 3;
    const ic = mesh.indices[t * 3 + 2] * 3;
    const p = mesh.positions;
    const ax = p[ia];
    const ay = p[ia + 1];
    const az = p[ia + 2];
    const bx = p[ib];
    const by = p[ib + 1];
    const bz = p[ib + 2];
    const cx = p[ic];
    const cy = p[ic + 1];
    const cz = p[ic + 2];
    total += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return total;
}

/** 와인딩이 만든 면 법선과 저장된 정점 법선 평균의 내적이 음수인 삼각형 인덱스 목록. */
function flippedTriangles(mesh: StudioGeometryMesh): number[] {
  const normals = mesh.normals;
  if (!normals) throw new Error("법선이 없습니다.");
  const flipped: number[] = [];
  const triangles = studioGeometryTriangleCount(mesh);
  for (let t = 0; t < triangles; t++) {
    const [fx, fy, fz] = studioGeometryFaceNormal(mesh, t);
    let vx = 0;
    let vy = 0;
    let vz = 0;
    for (let k = 0; k < 3; k++) {
      const base = mesh.indices[t * 3 + k] * 3;
      vx += normals[base];
      vy += normals[base + 1];
      vz += normals[base + 2];
    }
    if (fx * vx + fy * vy + fz * vz < 0) flipped.push(t);
  }
  return flipped;
}

describe("적대적 · 프리미티브 와인딩 대 저장된 법선", () => {
  it("격자는 와인딩과 +Z 법선이 일치한다", () => {
    const mesh = unwrap(studioGeometryGrid({ segmentsX: 3, segmentsY: 2 }));
    expect(flippedTriangles(mesh)).toEqual([]);
  });

  it("큐브 12삼각형 전부 바깥 방향이다", () => {
    const mesh = unwrap(studioGeometryCube({ segments: 2 }));
    expect(flippedTriangles(mesh)).toEqual([]);
    // 병합하면 닫힌 단위 정육면체 → 부피 정확히 1.
    const welded = studioGeometryMergeVertices(mesh).mesh;
    expect(studioGeometryBoundaryEdges(welded)).toEqual([]);
    expect(signedVolume(welded)).toBeCloseTo(1, 5);
  });

  it("구는 720 삼각형 전부 바깥 방향이다", () => {
    const mesh = unwrap(studioGeometrySphere());
    expect(flippedTriangles(mesh)).toEqual([]);
  });

  it("원기둥 옆면(캡 제외)은 바깥 방향이다", () => {
    const mesh = unwrap(studioGeometryCylinder({ caps: false }));
    expect(flippedTriangles(mesh)).toEqual([]);
  });

  it("원기둥 캡도 저장된 법선과 같은 방향이어야 한다", () => {
    const mesh = unwrap(studioGeometryCylinder({ segments: 8 }));
    expect(flippedTriangles(mesh)).toEqual([]);
  });

  it("캡 포함 원기둥은 병합 시 닫힌 입체이고 부피가 양수(=π r² h 근사)다", () => {
    const radius = 0.3;
    const height = 1;
    const segments = 16;
    const mesh = unwrap(studioGeometryCylinder({ radius, height, segments }));
    const welded = studioGeometryMergeVertices(mesh).mesh;
    expect(studioGeometryBoundaryEdges(welded)).toEqual([]);
    const expected = 0.5 * segments * radius * radius * Math.sin((2 * Math.PI) / segments) * height;
    expect(signedVolume(welded)).toBeCloseTo(expected, 5);
  });
});

describe("적대적 · 구 병합 위상", () => {
  it("구는 병합 후 닫힌 입체이고 부피가 내접 다면체 범위 안 양수다", () => {
    const radius = 0.5;
    const mesh = unwrap(studioGeometrySphere({ radius, segments: 32, rings: 24 }));
    const welded = studioGeometryMergeVertices(mesh).mesh;
    expect(studioGeometryBoundaryEdges(welded)).toEqual([]);
    const ideal = (4 / 3) * Math.PI * radius ** 3;
    const volume = signedVolume(welded);
    // 내접 다면체라 이상값보다 작아야 하고(볼록), 2% 이내여야 한다.
    expect(volume).toBeGreaterThan(ideal * 0.98);
    expect(volume).toBeLessThan(ideal);
  });
});

describe("적대적 · extrude 결과 입체", () => {
  it("1×1 격자를 두께 0.5 로 압출하면 부피가 정확히 0.5 인 닫힌 상자다", () => {
    const grid = unwrap(studioGeometryGrid());
    const solid = unwrap(studioGeometryExtrude(grid, { distance: 0.5 }));
    expect(studioGeometryVertexCount(solid)).toBe(8);
    expect(studioGeometryTriangleCount(solid)).toBe(12);
    const welded = studioGeometryMergeVertices(solid).mesh;
    expect(studioGeometryBoundaryEdges(welded)).toEqual([]);
    expect(signedVolume(welded)).toBeCloseTo(0.5, 6);
  });

  it("음수 거리로 압출해도 부피 절댓값은 같고 닫혀 있다", () => {
    const grid = unwrap(studioGeometryGrid());
    const solid = unwrap(studioGeometryExtrude(grid, { distance: -0.5 }));
    const welded = studioGeometryMergeVertices(solid).mesh;
    expect(studioGeometryBoundaryEdges(welded)).toEqual([]);
    expect(Math.abs(signedVolume(welded))).toBeCloseTo(0.5, 6);
  });
});

describe("적대적 · transform 회전 독립 대조", () => {
  it("Y축 90° 회전이 독립 구현한 회전 행렬과 일치한다", () => {
    const grid = unwrap(studioGeometryGrid());
    const angle = Math.PI / 2;
    const rotated = unwrap(studioGeometryTransform(grid, { rotate: [0, angle, 0] }));
    // 독립 참조: Ry = [[cos,0,sin],[0,1,0],[-sin,0,cos]] (양자화 없이 직접)
    const c = Math.round(Math.cos(angle) * 2 ** 20) / 2 ** 20;
    const s = Math.round(Math.sin(angle) * 2 ** 20) / 2 ** 20;
    for (let i = 0; i < studioGeometryVertexCount(grid); i++) {
      const x = grid.positions[i * 3];
      const y = grid.positions[i * 3 + 1];
      const z = grid.positions[i * 3 + 2];
      expect(rotated.positions[i * 3]).toBeCloseTo(c * x + s * z, 6);
      expect(rotated.positions[i * 3 + 1]).toBeCloseTo(y, 6);
      expect(rotated.positions[i * 3 + 2]).toBeCloseTo(-s * x + c * z, 6);
    }
  });

  it("음수 스케일(거울)은 와인딩을 뒤집어 부피 부호가 반전된다 — 문서화되지 않은 동작", () => {
    const cube = studioGeometryMergeVertices(unwrap(studioGeometryCube())).mesh;
    expect(signedVolume(cube)).toBeCloseTo(1, 5);
    const mirrored = unwrap(studioGeometryTransform(cube, { scale: [-1, 1, 1] }));
    expect(signedVolume(mirrored)).toBeCloseTo(-1, 5);
  });
});

describe("적대적 · 정점 수 sanity", () => {
  it("병합 후 큐브 정점은 정확히 8개다", () => {
    const mesh = unwrap(studioGeometryCube());
    expect(studioGeometryVertexCount(studioGeometryMergeVertices(mesh).mesh)).toBe(8);
  });
});
