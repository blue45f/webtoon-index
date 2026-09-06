import { describe, expect, it } from "vitest";

import {
  STUDIO_GEOMETRY_DEFAULT_BUDGETS,
  studioGeometryMeshBounds,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";
import {
  studioGeometryCube,
  studioGeometryCubeCounts,
  studioGeometryCylinder,
  studioGeometryCylinderCounts,
  studioGeometryGrid,
  studioGeometryGridCounts,
  studioGeometrySphere,
  studioGeometrySphereCounts,
} from "./studio-geometry-nodes-primitives";

import type { StudioGeometryMesh, StudioGeometryResult } from "./studio-geometry-nodes-mesh";

function unwrap(result: StudioGeometryResult<StudioGeometryMesh>): StudioGeometryMesh {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.value;
}

function uniquePositions(mesh: StudioGeometryMesh): string[] {
  const set = new Set<string>();
  for (let i = 0; i < studioGeometryVertexCount(mesh); i++) {
    set.add(
      [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]]
        .map((v) => (v === 0 ? 0 : v).toFixed(6))
        .join(",")
    );
  }
  return [...set].sort();
}

describe("studio-geometry-nodes-primitives · cube", () => {
  it("기본 큐브의 정점/삼각형 수가 공식 6(n+1)²·12n² 과 정확히 일치한다", () => {
    const mesh = unwrap(studioGeometryCube());
    expect(studioGeometryCubeCounts(1)).toEqual({ vertices: 24, triangles: 12 });
    expect(studioGeometryVertexCount(mesh)).toBe(24);
    expect(studioGeometryTriangleCount(mesh)).toBe(12);
  });

  it("세그먼트를 올리면 공식대로 커진다", () => {
    for (const n of [1, 2, 3, 8]) {
      const mesh = unwrap(studioGeometryCube({ segments: n }));
      const counts = studioGeometryCubeCounts(n);
      expect(counts).toEqual({ vertices: 6 * (n + 1) ** 2, triangles: 12 * n * n });
      expect(studioGeometryVertexCount(mesh)).toBe(counts.vertices);
      expect(studioGeometryTriangleCount(mesh)).toBe(counts.triangles);
    }
  });

  it("고유 좌표는 정확히 ±0.5 의 8개 코너다(면 분리 정점이라 24개로 저장됨)", () => {
    const mesh = unwrap(studioGeometryCube());
    const corners: string[] = [];
    for (const x of [-0.5, 0.5]) {
      for (const y of [-0.5, 0.5]) {
        for (const z of [-0.5, 0.5]) corners.push([x, y, z].map((v) => v.toFixed(6)).join(","));
      }
    }
    expect(uniquePositions(mesh)).toEqual(corners.sort());
  });

  it("size 를 바꾸면 바운딩 박스가 정확히 ±size/2 다", () => {
    const mesh = unwrap(studioGeometryCube({ size: 3 }));
    expect(studioGeometryMeshBounds(mesh)).toEqual({ min: [-1.5, -1.5, -1.5], max: [1.5, 1.5, 1.5] });
  });

  it("모든 법선이 축 정렬 단위 벡터다(면 분리 정점의 직접 확인)", () => {
    const mesh = unwrap(studioGeometryCube());
    expect(mesh.normals).not.toBeNull();
    const normals = mesh.normals as Float32Array;
    for (let i = 0; i < studioGeometryVertexCount(mesh); i++) {
      const components = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
      const nonZero = components.filter((v) => v !== 0);
      expect(nonZero).toHaveLength(1);
      expect(Math.abs(nonZero[0])).toBe(1);
    }
  });

  it("예산을 넘기면 budget-exceeded 로 거부한다(예외 없음)", () => {
    const result = studioGeometryCube(
      { segments: 64 },
      { ...STUDIO_GEOMETRY_DEFAULT_BUDGETS, maxVertices: 100 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("budget-exceeded");
  });
});

describe("studio-geometry-nodes-primitives · sphere", () => {
  it("기본 구는 425 정점 · 720 삼각형(=(24+1)(16+1), 24·(2·16−2))", () => {
    const mesh = unwrap(studioGeometrySphere());
    expect(studioGeometrySphereCounts(24, 16)).toEqual({ vertices: 425, triangles: 720 });
    expect(studioGeometryVertexCount(mesh)).toBe(425);
    expect(studioGeometryTriangleCount(mesh)).toBe(720);
  });

  it("극점 좌표가 정확하다 — 위쪽 (0, r, 0) / 아래쪽 (0, −r, 0)", () => {
    const radius = 0.5;
    const segments = 24;
    const rings = 16;
    const mesh = unwrap(studioGeometrySphere({ radius, segments, rings }));
    for (let ix = 0; ix <= segments; ix++) {
      expect(Math.abs(mesh.positions[ix * 3])).toBe(0);
      expect(mesh.positions[ix * 3 + 1]).toBe(radius);
      expect(Math.abs(mesh.positions[ix * 3 + 2])).toBe(0);
    }
    const bottomStart = rings * (segments + 1);
    for (let ix = 0; ix <= segments; ix++) {
      const base = (bottomStart + ix) * 3;
      expect(Math.abs(mesh.positions[base])).toBe(0);
      expect(mesh.positions[base + 1]).toBe(-radius);
      expect(Math.abs(mesh.positions[base + 2])).toBe(0);
    }
  });

  it("모든 정점이 반지름 위에 있다(양자화 오차 1e-5 이내)", () => {
    const radius = 2;
    const mesh = unwrap(studioGeometrySphere({ radius, segments: 32, rings: 24 }));
    for (let i = 0; i < studioGeometryVertexCount(mesh); i++) {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(radius, 4);
    }
  });

  it("두 번 만든 구는 바이트 단위로 동일하다(삼각함수 양자화 덕분)", () => {
    const a = unwrap(studioGeometrySphere({ segments: 17, rings: 13 }));
    const b = unwrap(studioGeometrySphere({ segments: 17, rings: 13 }));
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
  });
});

describe("studio-geometry-nodes-primitives · cylinder", () => {
  it("캡 포함 기본 원기둥은 70 정점 · 64 삼각형(4n+6, 4n)", () => {
    const mesh = unwrap(studioGeometryCylinder());
    expect(studioGeometryCylinderCounts(16, true)).toEqual({ vertices: 70, triangles: 64 });
    expect(studioGeometryVertexCount(mesh)).toBe(70);
    expect(studioGeometryTriangleCount(mesh)).toBe(64);
  });

  it("캡을 끄면 옆면만 남는다(2n+2, 2n)", () => {
    const mesh = unwrap(studioGeometryCylinder({ caps: false }));
    expect(studioGeometryCylinderCounts(16, false)).toEqual({ vertices: 34, triangles: 32 });
    expect(studioGeometryVertexCount(mesh)).toBe(34);
    expect(studioGeometryTriangleCount(mesh)).toBe(32);
  });

  it("바운딩 박스가 반지름·높이와 정확히 맞는다", () => {
    const mesh = unwrap(studioGeometryCylinder({ radius: 1, height: 4, segments: 4 }));
    const bounds = studioGeometryMeshBounds(mesh);
    expect(bounds).not.toBeNull();
    if (!bounds) return;
    expect(bounds.min[1]).toBe(-2);
    expect(bounds.max[1]).toBe(2);
    expect(bounds.max[0]).toBeCloseTo(1, 5);
    expect(bounds.min[0]).toBeCloseTo(-1, 5);
  });
});

describe("studio-geometry-nodes-primitives · grid", () => {
  it("셀 수 = nx·ny, 삼각형 = 2·nx·ny, 정점 = (nx+1)(ny+1)", () => {
    for (const [nx, ny] of [
      [1, 1],
      [3, 2],
      [8, 5],
    ]) {
      const mesh = unwrap(studioGeometryGrid({ segmentsX: nx, segmentsY: ny }));
      const counts = studioGeometryGridCounts(nx, ny);
      expect(counts).toEqual({ vertices: (nx + 1) * (ny + 1), triangles: 2 * nx * ny });
      expect(studioGeometryVertexCount(mesh)).toBe(counts.vertices);
      expect(studioGeometryTriangleCount(mesh)).toBe(counts.triangles);
    }
  });

  it("1×1 격자는 XY 평면 위 정확한 네 모서리다", () => {
    const mesh = unwrap(studioGeometryGrid());
    expect(Array.from(mesh.positions)).toEqual([
      -0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0,
    ]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 2, 1, 3]);
  });

  it("법선이 전부 +Z 다", () => {
    const mesh = unwrap(studioGeometryGrid({ segmentsX: 2, segmentsY: 2 }));
    const normals = mesh.normals as Float32Array;
    for (let i = 0; i < studioGeometryVertexCount(mesh); i++) {
      expect([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]).toEqual([0, 0, 1]);
    }
  });
});
