import { describe, expect, it } from "vitest";

import {
  hasValidStudioBg3dCanonicalGeometryNumbers,
  isStudioBg3dCanonicalGeometryPayload,
} from "./bg3d/studio-bg3d-geometry-worker-protocol";
import {
  createStudioGeometryMesh,
  STUDIO_GEOMETRY_DEFAULT_BUDGETS,
  STUDIO_GEOMETRY_TRIG_QUANTUM,
  studioGeometryBoundaryEdges,
  studioGeometryComputeVertexNormals,
  studioGeometryCos,
  studioGeometryEmptyMesh,
  studioGeometryMergeVertices,
  studioGeometryMeshByteLength,
  studioGeometrySin,
  studioGeometrySurfaceArea,
  studioGeometryTriangleArea,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
  studioGeometryWithVertexNormals,
  toStudioBg3dCanonicalGeometryPayload,
} from "./studio-geometry-nodes-mesh";
import { studioGeometryCube, studioGeometryGrid } from "./studio-geometry-nodes-primitives";

import type { StudioGeometryMesh, StudioGeometryResult } from "./studio-geometry-nodes-mesh";

function unwrap<T>(result: StudioGeometryResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.value;
}

describe("studio-geometry-nodes-mesh · 검증", () => {
  it("인덱스가 범위를 벗어나면 index-out-of-range 로 거부한다", () => {
    const result = createStudioGeometryMesh({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 5]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("index-out-of-range");
  });

  it("좌표 길이가 3의 배수가 아니면 invalid-position-count", () => {
    const result = createStudioGeometryMesh({
      positions: new Float32Array([0, 0, 0, 1]),
      indices: new Uint32Array([]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("invalid-position-count");
  });

  it("NaN 좌표는 non-finite 로 거부한다", () => {
    const result = createStudioGeometryMesh({
      positions: new Float32Array([0, 0, 0, Number.NaN, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("non-finite");
  });

  it("normals/uvs 길이가 어긋나면 attribute-length-mismatch", () => {
    const base = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const badNormals = createStudioGeometryMesh({ ...base, normals: new Float32Array(6) });
    expect(badNormals.ok).toBe(false);
    if (!badNormals.ok) expect(badNormals.code).toBe("attribute-length-mismatch");
    const badUvs = createStudioGeometryMesh({ ...base, uvs: new Float32Array(4) });
    expect(badUvs.ok).toBe(false);
    if (!badUvs.ok) expect(badUvs.code).toBe("attribute-length-mismatch");
  });

  it("월드 좌표 상한을 넘으면 budget-exceeded", () => {
    const result = createStudioGeometryMesh({
      positions: new Float32Array([0, 0, 0, 20_000, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("budget-exceeded");
  });

  it("정점 예산을 넘으면 budget-exceeded", () => {
    const result = createStudioGeometryMesh(
      { positions: new Float32Array(9), indices: new Uint32Array([0, 1, 2]) },
      { ...STUDIO_GEOMETRY_DEFAULT_BUDGETS, maxVertices: 2 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("budget-exceeded");
  });
});

describe("studio-geometry-nodes-mesh · 기하", () => {
  const triangle = unwrap(
    createStudioGeometryMesh({
      positions: new Float32Array([0, 0, 0, 4, 0, 0, 0, 3, 0]),
      indices: new Uint32Array([0, 1, 2]),
    })
  );

  it("삼각형 면적은 밑변×높이/2 다", () => {
    expect(studioGeometryTriangleArea(triangle, 0)).toBe(6);
    expect(studioGeometrySurfaceArea(triangle)).toBe(6);
  });

  it("정점 법선은 면 법선(+Z) 과 일치한다", () => {
    expect(Array.from(studioGeometryComputeVertexNormals(triangle))).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
  });

  it("경계 엣지: 열린 삼각형 3개 · 닫힌 큐브 0개", () => {
    expect(studioGeometryBoundaryEdges(triangle)).toHaveLength(3);
    const cube = unwrap(studioGeometryCube());
    // 면마다 정점을 분리했으므로 위상적으로는 열려 있다 — 병합하면 닫힌다.
    const welded = studioGeometryMergeVertices(cube).mesh;
    expect(studioGeometryVertexCount(welded)).toBe(8);
    expect(studioGeometryTriangleCount(welded)).toBe(12);
    expect(studioGeometryBoundaryEdges(welded)).toHaveLength(0);
  });

  it("정점 병합은 양자화 좌표가 같은 정점을 합치고 퇴화 삼각형을 버린다", () => {
    const duplicated = unwrap(
      createStudioGeometryMesh({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]),
        indices: new Uint32Array([0, 1, 2, 3, 1, 2, 0, 3, 1]),
      })
    );
    const { mesh, remap } = studioGeometryMergeVertices(duplicated);
    expect(studioGeometryVertexCount(mesh)).toBe(3);
    expect(Array.from(remap)).toEqual([0, 1, 2, 0]);
    // (0,3,1) 은 3→0 으로 접혀 퇴화하므로 버려지고, 남는 두 삼각형은 동일 인덱스가 된다.
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("studioGeometryEmptyMesh 는 아무 속성도 없는 0 크기 메시다", () => {
    const empty = studioGeometryEmptyMesh();
    expect(studioGeometryVertexCount(empty)).toBe(0);
    expect(studioGeometryTriangleCount(empty)).toBe(0);
    expect(empty.normals).toBeNull();
    expect(empty.uvs).toBeNull();
    expect(studioGeometryMeshByteLength(empty)).toBe(0);
  });

  it("studioGeometryWithVertexNormals 는 없을 때만 계산하고 있으면 그대로 둔다", () => {
    const bare: StudioGeometryMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      normals: null,
      uvs: null,
    };
    const filled = studioGeometryWithVertexNormals(bare);
    expect(Array.from(filled.normals as Float32Array)).toEqual([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    expect(studioGeometryWithVertexNormals(filled)).toBe(filled);
  });

  it("메시 바이트 길이는 모든 속성 버퍼의 합이다", () => {
    const grid = unwrap(studioGeometryGrid({ segmentsX: 2, segmentsY: 2 }));
    const expected =
      grid.positions.byteLength +
      grid.indices.byteLength +
      (grid.normals?.byteLength ?? 0) +
      (grid.uvs?.byteLength ?? 0);
    expect(studioGeometryMeshByteLength(grid)).toBe(expected);
  });
});

describe("studio-geometry-nodes-mesh · 결정성 장치", () => {
  it("삼각함수는 2^-20 격자로 양자화된다", () => {
    expect(studioGeometryCos(0)).toBe(1);
    expect(studioGeometrySin(0)).toBe(0);
    // cos(π/2) 의 참값은 6.12e-17 — 양자화되어 정확히 0 이 된다.
    expect(studioGeometryCos(Math.PI / 2)).toBe(0);
    expect(studioGeometrySin(Math.PI)).toBe(0);
    expect(studioGeometryCos(Math.PI)).toBe(-1);
    const value = studioGeometrySin(0.37);
    expect(value / STUDIO_GEOMETRY_TRIG_QUANTUM).toBe(
      Math.round(value / STUDIO_GEOMETRY_TRIG_QUANTUM)
    );
    expect(Math.abs(value - Math.sin(0.37))).toBeLessThan(STUDIO_GEOMETRY_TRIG_QUANTUM);
  });

  it("비유한 입력은 0 으로 접힌다", () => {
    expect(studioGeometryCos(Number.NaN)).toBe(0);
    expect(studioGeometrySin(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("studio-geometry-nodes-mesh · 렌더러 브리지", () => {
  it("변환한 페이로드가 기존 3D 배경 임포트 계약 검증기를 통과한다", () => {
    const grid = unwrap(studioGeometryGrid({ segmentsX: 3, segmentsY: 2 }));
    const payload = unwrap(toStudioBg3dCanonicalGeometryPayload(grid));
    expect(isStudioBg3dCanonicalGeometryPayload(payload)).toBe(true);
    expect(hasValidStudioBg3dCanonicalGeometryNumbers(payload)).toBe(true);
    expect(payload.vertexCount).toBe(studioGeometryVertexCount(grid));
    expect(payload.triangleCount).toBe(studioGeometryTriangleCount(grid));
    expect(payload.attributes.map((attribute) => attribute.name)).toEqual([
      "position",
      "normal",
      "uv",
    ]);
    expect(payload.index).not.toBeNull();
    expect(payload.index?.count).toBe(grid.indices.length);
  });

  it("법선이 없으면 계산해서 채운다", () => {
    const mesh: StudioGeometryMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2]),
      normals: null,
      uvs: null,
    };
    const payload = unwrap(toStudioBg3dCanonicalGeometryPayload(mesh));
    const normal = payload.attributes.find((attribute) => attribute.name === "normal");
    expect(normal).toBeDefined();
    expect(Array.from(new Float32Array(normal?.buffer ?? new ArrayBuffer(0)))).toEqual([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]);
  });

  it("빈 메시는 empty-geometry 로 거부한다", () => {
    const result = toStudioBg3dCanonicalGeometryPayload({
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      normals: null,
      uvs: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("empty-geometry");
  });
});
