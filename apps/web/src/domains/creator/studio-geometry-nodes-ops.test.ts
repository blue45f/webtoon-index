import { describe, expect, it } from "vitest";

import {
  createStudioGeometryMesh,
  STUDIO_GEOMETRY_DEFAULT_BUDGETS,
  studioGeometryBoundaryEdges,
  studioGeometryMergeVertices,
  studioGeometrySurfaceArea,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";
import {
  studioGeometryAttributeMath,
  studioGeometryDistributePointsOnFaces,
  studioGeometryExtrude,
  studioGeometryInstanceOnPoints,
  studioGeometryJoin,
  studioGeometryPositionAttribute,
  studioGeometrySubdivide,
  studioGeometryTransform,
  studioGeometryUniqueEdgeCount,
  studioGeometryWithPositions,
} from "./studio-geometry-nodes-ops";
import { studioGeometryCube, studioGeometryGrid } from "./studio-geometry-nodes-primitives";

import type {
  StudioGeometryMesh,
  StudioGeometryPoints,
  StudioGeometryResult,
} from "./studio-geometry-nodes-mesh";

function unwrap<T>(result: StudioGeometryResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.value;
}

const HALF_PI = Math.PI / 2;

describe("studio-geometry-nodes-ops · transform", () => {
  it("Z축 90° 회전이 좌표를 정확히 (x,y) → (−y,x) 로 보낸다", () => {
    const grid = unwrap(studioGeometryGrid());
    const rotated = unwrap(studioGeometryTransform(grid, { rotate: [0, 0, HALF_PI] }));
    // 원본 (−0.5,−0.5,0) → (0.5,−0.5,0), (0.5,−0.5,0) → (0.5,0.5,0) …
    expect(Array.from(rotated.positions)).toEqual([
      0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5, 0.5, 0,
    ]);
  });

  it("Y축 90° 회전은 +X 를 −Z 로 보낸다(오른손 XYZ 오일러)", () => {
    const mesh = unwrap(
      createStudioGeometryMesh({
        positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
        indices: new Uint32Array([0, 1, 2]),
      })
    );
    const rotated = unwrap(studioGeometryTransform(mesh, { rotate: [0, HALF_PI, 0] }));
    expect(Array.from(rotated.positions)).toEqual([0, 0, -1, 0, 1, 0, 1, 0, 0]);
  });

  it("스케일·이동이 순서대로(스케일 → 회전 → 이동) 적용된다", () => {
    const mesh = unwrap(
      createStudioGeometryMesh({
        positions: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 0]),
        indices: new Uint32Array([0, 1, 2]),
      })
    );
    const out = unwrap(
      studioGeometryTransform(mesh, {
        scale: [2, 3, 1],
        rotate: [0, 0, HALF_PI],
        translate: [10, 20, 30],
      })
    );
    // (1,0,0) → 스케일 (2,0,0) → 회전 (0,2,0) → 이동 (10,22,30)
    expect(Array.from(out.positions).slice(0, 3)).toEqual([10, 22, 30]);
    // (0,1,0) → 스케일 (0,3,0) → 회전 (−3,0,0) → 이동 (7,20,30)
    expect(Array.from(out.positions).slice(3, 6)).toEqual([7, 20, 30]);
  });

  it("비균일 스케일에서도 법선이 단위 길이를 유지한다", () => {
    const cube = unwrap(studioGeometryCube());
    const out = unwrap(studioGeometryTransform(cube, { scale: [1, 4, 0.25] }));
    const normals = out.normals as Float32Array;
    for (let i = 0; i < studioGeometryVertexCount(out); i++) {
      const x = normals[i * 3];
      const y = normals[i * 3 + 1];
      const z = normals[i * 3 + 2];
      expect(Math.sqrt(x * x + y * y + z * z)).toBeCloseTo(1, 5);
    }
  });

  it("스케일 0 은 1e-6 으로 대체되어 NaN 을 만들지 않는다", () => {
    const grid = unwrap(studioGeometryGrid());
    const out = unwrap(studioGeometryTransform(grid, { scale: [1, 1, 0] }));
    for (const value of out.positions) expect(Number.isFinite(value)).toBe(true);
  });
});

describe("studio-geometry-nodes-ops · join", () => {
  it("두 메시를 합치면 정점/삼각형이 더해지고 인덱스가 정확히 오프셋된다", () => {
    const a = unwrap(studioGeometryGrid());
    const b = unwrap(studioGeometryTransform(a, { translate: [5, 0, 0] }));
    const joined = unwrap(studioGeometryJoin([a, b]));
    expect(studioGeometryVertexCount(joined)).toBe(8);
    expect(studioGeometryTriangleCount(joined)).toBe(4);
    expect(Array.from(joined.indices)).toEqual([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
    expect(Array.from(joined.positions).slice(0, 12)).toEqual(Array.from(a.positions));
    expect(Array.from(joined.positions).slice(12)).toEqual(Array.from(b.positions));
  });

  it("빈 메시는 무시하고, 전부 비면 빈 메시를 낸다", () => {
    const a = unwrap(studioGeometryGrid());
    const empty: StudioGeometryMesh = {
      positions: new Float32Array(0),
      indices: new Uint32Array(0),
      normals: null,
      uvs: null,
    };
    expect(studioGeometryVertexCount(unwrap(studioGeometryJoin([a, empty])))).toBe(4);
    expect(studioGeometryVertexCount(unwrap(studioGeometryJoin([empty, empty])))).toBe(0);
  });

  it("한쪽에 UV 가 없으면 결과도 UV 를 만들지 않는다(가짜 UV 금지)", () => {
    const a = unwrap(studioGeometryGrid());
    const bare = unwrap(
      createStudioGeometryMesh({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        indices: new Uint32Array([0, 1, 2]),
      })
    );
    expect(unwrap(studioGeometryJoin([a, bare])).uvs).toBeNull();
    expect(unwrap(studioGeometryJoin([a, a])).uvs).not.toBeNull();
  });
});

describe("studio-geometry-nodes-ops · subdivide", () => {
  it("F → 4F, V → V+E 가 정확히 성립한다(격자·큐브)", () => {
    for (const mesh of [unwrap(studioGeometryGrid()), unwrap(studioGeometryCube())]) {
      const vertices = studioGeometryVertexCount(mesh);
      const triangles = studioGeometryTriangleCount(mesh);
      const edges = studioGeometryUniqueEdgeCount(mesh);
      const out = unwrap(studioGeometrySubdivide(mesh, 1));
      expect(studioGeometryTriangleCount(out)).toBe(triangles * 4);
      expect(studioGeometryVertexCount(out)).toBe(vertices + edges);
    }
  });

  it("1×1 격자의 고유 엣지는 5개, 세분화 결과는 9정점·8삼각형이다", () => {
    const grid = unwrap(studioGeometryGrid());
    expect(studioGeometryUniqueEdgeCount(grid)).toBe(5);
    const out = unwrap(studioGeometrySubdivide(grid, 1));
    expect(studioGeometryVertexCount(out)).toBe(9);
    expect(studioGeometryTriangleCount(out)).toBe(8);
  });

  it("새 정점이 정확한 중점 좌표를 갖는다", () => {
    const grid = unwrap(studioGeometryGrid());
    const out = unwrap(studioGeometrySubdivide(grid, 1));
    const created = Array.from(out.positions).slice(12);
    // 엣지 0-1 → (0,−0.5,0), 1-2 → (0,0,0), 0-2 → (−0.5,0,0), 1-3 → (0.5,0,0), 2-3 → (0,0.5,0)
    expect(created).toEqual([0, -0.5, 0, 0, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 0, 0.5, 0]);
  });

  it("면적이 보존된다(선형 분할이므로 정확히)", () => {
    const grid = unwrap(studioGeometryGrid({ sizeX: 2, sizeY: 3 }));
    const before = studioGeometrySurfaceArea(grid);
    const after = studioGeometrySurfaceArea(unwrap(studioGeometrySubdivide(grid, 2)));
    expect(after).toBeCloseTo(before, 5);
    expect(before).toBeCloseTo(6, 5);
  });

  it("반복 0 은 입력을 그대로 돌려주고, 상한(4)을 넘으면 4 로 클램프된다", () => {
    const grid = unwrap(studioGeometryGrid());
    expect(unwrap(studioGeometrySubdivide(grid, 0))).toBe(grid);
    const clamped = unwrap(studioGeometrySubdivide(grid, 99));
    const four = unwrap(studioGeometrySubdivide(grid, 4));
    expect(studioGeometryTriangleCount(clamped)).toBe(studioGeometryTriangleCount(four));
    expect(studioGeometryTriangleCount(four)).toBe(2 * 4 ** 4);
  });

  it("삼각형 예산을 넘으면 budget-exceeded 로 거부한다", () => {
    const grid = unwrap(studioGeometryGrid());
    const result = studioGeometrySubdivide(grid, 3, {
      ...STUDIO_GEOMETRY_DEFAULT_BUDGETS,
      maxTriangles: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("budget-exceeded");
  });
});

describe("studio-geometry-nodes-ops · extrude", () => {
  it("1×1 격자를 압출하면 정확히 8정점·12삼각형의 닫힌 상자가 된다", () => {
    const grid = unwrap(studioGeometryGrid());
    expect(studioGeometryBoundaryEdges(grid)).toHaveLength(4);
    const solid = unwrap(studioGeometryExtrude(grid, { distance: 0.5 }));
    expect(studioGeometryVertexCount(solid)).toBe(8);
    expect(studioGeometryTriangleCount(solid)).toBe(12);
    // 모든 엣지가 정확히 두 삼각형에 속한다 = 경계 엣지 0개 = 닫힌 입체.
    expect(studioGeometryBoundaryEdges(solid)).toHaveLength(0);
  });

  it("오프셋 거리가 법선 방향으로 정확히 적용된다", () => {
    const grid = unwrap(studioGeometryGrid());
    const solid = unwrap(studioGeometryExtrude(grid, { distance: 0.25 }));
    for (let i = 0; i < 4; i++) expect(solid.positions[i * 3 + 2]).toBeCloseTo(0.25, 6);
    for (let i = 4; i < 8; i++) expect(solid.positions[i * 3 + 2]).toBe(0);
  });

  it("표면적 = 위 + 아래 + 옆면 둘레×두께", () => {
    const grid = unwrap(studioGeometryGrid({ sizeX: 2, sizeY: 3 }));
    const solid = unwrap(studioGeometryExtrude(grid, { distance: 0.5 }));
    // 2×3 판 양면(12) + 둘레 10 × 두께 0.5 (5) = 17
    expect(studioGeometrySurfaceArea(solid)).toBeCloseTo(17, 4);
  });

  it("capOriginal=false 면 바닥 캡이 빠져 삼각형이 2개 줄고 열린 채로 남는다", () => {
    const grid = unwrap(studioGeometryGrid());
    const open = unwrap(studioGeometryExtrude(grid, { distance: 0.5, capOriginal: false }));
    expect(studioGeometryTriangleCount(open)).toBe(10);
    expect(studioGeometryBoundaryEdges(open)).toHaveLength(4);
  });

  it("위상적으로 닫힌(병합된) 메시는 경계가 없어 껍데기만 복제된다", () => {
    const welded = studioGeometryMergeVertices(unwrap(studioGeometryCube())).mesh;
    expect(studioGeometryBoundaryEdges(welded)).toHaveLength(0);
    const shell = unwrap(studioGeometryExtrude(welded, { distance: 0.1 }));
    expect(studioGeometryTriangleCount(shell)).toBe(studioGeometryTriangleCount(welded) * 2);
    expect(studioGeometryVertexCount(shell)).toBe(studioGeometryVertexCount(welded) * 2);
  });

  it("면 분리 프리미티브는 위상적으로 열려 있어 면마다 측면이 생긴다(문서화된 함정)", () => {
    const cube = unwrap(studioGeometryCube());
    // 6면 × 4엣지 = 24개 경계 엣지 → 측면 삼각형 48개 + 위 12 + 아래 12 = 72
    expect(studioGeometryBoundaryEdges(cube)).toHaveLength(24);
    const shell = unwrap(studioGeometryExtrude(cube, { distance: 0.1 }));
    expect(studioGeometryTriangleCount(shell)).toBe(72);
  });

  it("빈 메시는 empty-geometry 로 거부한다", () => {
    const result = studioGeometryExtrude(
      { positions: new Float32Array(0), indices: new Uint32Array(0), normals: null, uvs: null },
      { distance: 1 }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("empty-geometry");
  });
});

describe("studio-geometry-nodes-ops · distribute-points-on-faces", () => {
  /** 면적 1 과 면적 18 의 삼각형 두 개(x<5 가 작은 쪽). */
  const weighted = unwrap(
    createStudioGeometryMesh({
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0, 10, 0, 0, 16, 0, 0, 10, 6, 0]),
      indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    })
  );

  it("면적 가중이 실제로 작동한다 — 18배 큰 면에 압도적으로 많이 뿌려진다", () => {
    const points = unwrap(
      studioGeometryDistributePointsOnFaces(weighted, { count: 4_000, seed: 7 })
    );
    let small = 0;
    for (let i = 0; i < 4_000; i++) {
      if (points.positions[i * 3] < 5) small += 1;
    }
    const large = 4_000 - small;
    // 기대 비율 1:18 → 작은 면 약 210개. 통계 흔들림을 넉넉히 잡아도 균등(2000)과는 확연히 다르다.
    expect(small).toBeGreaterThan(120);
    expect(small).toBeLessThan(320);
    expect(large / small).toBeGreaterThan(10);
  });

  it("모든 포인트가 자기 삼각형 평면(z=0) 위에 있고 바운딩 안에 든다", () => {
    const points = unwrap(studioGeometryDistributePointsOnFaces(weighted, { count: 500, seed: 3 }));
    for (let i = 0; i < 500; i++) {
      expect(points.positions[i * 3 + 2]).toBe(0);
      expect(points.positions[i * 3]).toBeGreaterThanOrEqual(0);
      expect(points.positions[i * 3]).toBeLessThanOrEqual(16);
      expect(points.positions[i * 3 + 1]).toBeGreaterThanOrEqual(0);
      expect(points.positions[i * 3 + 1]).toBeLessThanOrEqual(6);
    }
  });

  it("같은 시드는 바이트 동일, 다른 시드는 다른 결과", () => {
    const a = unwrap(studioGeometryDistributePointsOnFaces(weighted, { count: 64, seed: 42 }));
    const b = unwrap(studioGeometryDistributePointsOnFaces(weighted, { count: 64, seed: 42 }));
    const c = unwrap(studioGeometryDistributePointsOnFaces(weighted, { count: 64, seed: 43 }));
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(c.positions)).not.toEqual(Array.from(a.positions));
  });

  it("법선은 면 법선(+Z) 을 그대로 물려받는다", () => {
    const points = unwrap(studioGeometryDistributePointsOnFaces(weighted, { count: 10, seed: 1 }));
    expect(points.normals).not.toBeNull();
    expect(Array.from(points.normals as Float32Array)).toEqual(
      Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? 1 : 0))
    );
  });

  it("density 로도 개수를 정할 수 있다(면적 19 × density 2 ≈ 38)", () => {
    const points = unwrap(studioGeometryDistributePointsOnFaces(weighted, { density: 2, seed: 1 }));
    expect(points.positions.length / 3).toBe(38);
  });

  it("개수 0 이하와 면적 0 입력은 각각의 코드로 거부한다", () => {
    const zero = studioGeometryDistributePointsOnFaces(weighted, { count: 0, seed: 1 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.code).toBe("invalid-parameter");
    const degenerate = unwrap(
      createStudioGeometryMesh({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
        indices: new Uint32Array([0, 1, 2]),
      })
    );
    const flat = studioGeometryDistributePointsOnFaces(degenerate, { count: 4, seed: 1 });
    expect(flat.ok).toBe(false);
    if (!flat.ok) expect(flat.code).toBe("degenerate-input");
  });
});

describe("studio-geometry-nodes-ops · instance-on-points", () => {
  const points: StudioGeometryPoints = {
    positions: new Float32Array([0, 0, 0, 3, 0, 0, 0, 3, 0]),
    normals: null,
  };

  it("총 정점 = 포인트 수 × 인스턴스 정점, 총 삼각형도 마찬가지", () => {
    const cube = unwrap(studioGeometryCube());
    const out = unwrap(studioGeometryInstanceOnPoints(cube, points, { seed: 0 }));
    expect(studioGeometryVertexCount(out)).toBe(3 * 24);
    expect(studioGeometryTriangleCount(out)).toBe(3 * 12);
  });

  it("회전·지터가 없으면 인스턴스는 정확히 포인트만큼 평행이동된다", () => {
    const grid = unwrap(studioGeometryGrid());
    const out = unwrap(studioGeometryInstanceOnPoints(grid, points, { seed: 0 }));
    expect(Array.from(out.positions).slice(0, 12)).toEqual(Array.from(grid.positions));
    expect(Array.from(out.positions).slice(12, 24)).toEqual(
      Array.from(grid.positions).map((value, index) => (index % 3 === 0 ? value + 3 : value))
    );
  });

  it("인덱스가 인스턴스마다 정확히 오프셋된다", () => {
    const grid = unwrap(studioGeometryGrid());
    const out = unwrap(studioGeometryInstanceOnPoints(grid, points, { seed: 0 }));
    expect(Array.from(out.indices)).toEqual([
      0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7, 8, 9, 10, 10, 9, 11,
    ]);
  });

  it("시드 결정성 — 같은 시드는 바이트 동일, 다른 시드는 다르다", () => {
    const grid = unwrap(studioGeometryGrid());
    const params = { seed: 9, randomRotation: true, scaleJitter: 0.5 };
    const a = unwrap(studioGeometryInstanceOnPoints(grid, points, params));
    const b = unwrap(studioGeometryInstanceOnPoints(grid, points, params));
    const c = unwrap(studioGeometryInstanceOnPoints(grid, points, { ...params, seed: 10 }));
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(c.positions)).not.toEqual(Array.from(a.positions));
  });

  it("인스턴스 예산을 넘는 포인트는 잘라낸다(거부가 아니라 상한 적용)", () => {
    const grid = unwrap(studioGeometryGrid());
    const many: StudioGeometryPoints = { positions: new Float32Array(30), normals: null };
    const out = unwrap(
      studioGeometryInstanceOnPoints(grid, many, { seed: 0 }, {
        ...STUDIO_GEOMETRY_DEFAULT_BUDGETS,
        maxInstances: 4,
      })
    );
    expect(studioGeometryVertexCount(out)).toBe(4 * 4);
  });

  it("빈 인스턴스·빈 포인트는 empty-geometry 로 거부한다", () => {
    const grid = unwrap(studioGeometryGrid());
    const emptyPoints: StudioGeometryPoints = { positions: new Float32Array(0), normals: null };
    const noPoints = studioGeometryInstanceOnPoints(grid, emptyPoints, { seed: 0 });
    expect(noPoints.ok).toBe(false);
    if (!noPoints.ok) expect(noPoints.code).toBe("empty-geometry");
  });
});

describe("studio-geometry-nodes-ops · attribute-math", () => {
  const vectors = {
    domain: "point" as const,
    itemSize: 3 as const,
    values: new Float32Array([3, 4, 0, 1, 2, 2, -1, 0, 0]),
  };

  it("vec3 상수와의 성분별 사칙연산", () => {
    expect(
      Array.from(unwrap(studioGeometryAttributeMath({ a: vectors, b: [1, 2, 3], op: "add" })).values)
    ).toEqual([4, 6, 3, 2, 4, 5, 0, 2, 3]);
    expect(
      Array.from(
        unwrap(studioGeometryAttributeMath({ a: vectors, b: 2, op: "multiply" })).values
      )
    ).toEqual([6, 8, 0, 2, 4, 4, -2, 0, 0]);
    expect(
      Array.from(
        unwrap(studioGeometryAttributeMath({ a: vectors, b: [1, 2, 3], op: "subtract" })).values
      )
    ).toEqual([2, 2, -3, 0, 0, -1, -2, -2, -3]);
  });

  it("0 으로 나누면 0 으로 수렴한다(NaN/Infinity 금지)", () => {
    const out = unwrap(studioGeometryAttributeMath({ a: vectors, b: 0, op: "divide" }));
    expect(Array.from(out.values)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("length 는 vec3 → 스칼라(itemSize 1)", () => {
    const out = unwrap(studioGeometryAttributeMath({ a: vectors, op: "length" }));
    expect(out.itemSize).toBe(1);
    expect(Array.from(out.values)).toEqual([5, 3, 1]);
  });

  it("dot 도 스칼라를 낸다", () => {
    const out = unwrap(studioGeometryAttributeMath({ a: vectors, b: [1, 1, 1], op: "dot" }));
    expect(out.itemSize).toBe(1);
    expect(Array.from(out.values)).toEqual([7, 5, -1]);
  });

  it("min/max/clamp/mix", () => {
    expect(
      Array.from(unwrap(studioGeometryAttributeMath({ a: vectors, b: 1, op: "minimum" })).values)
    ).toEqual([1, 1, 0, 1, 1, 1, -1, 0, 0]);
    expect(
      Array.from(unwrap(studioGeometryAttributeMath({ a: vectors, b: 1, op: "maximum" })).values)
    ).toEqual([3, 4, 1, 1, 2, 2, 1, 1, 1]);
    expect(
      Array.from(
        unwrap(studioGeometryAttributeMath({ a: vectors, b: 0, c: 2, op: "clamp" })).values
      )
    ).toEqual([2, 2, 0, 1, 2, 2, 0, 0, 0]);
    // mix(a, b=10, t=0.5)
    expect(
      Array.from(
        unwrap(studioGeometryAttributeMath({ a: vectors, b: 10, c: 0.5, op: "mix" })).values
      )
    ).toEqual([6.5, 7, 5, 5.5, 6, 6, 4.5, 5, 5]);
  });

  it("스칼라 속성에 dot/length 를 쓰면 input-type-mismatch", () => {
    const scalars = {
      domain: "point" as const,
      itemSize: 1 as const,
      values: new Float32Array([1, 2, 3]),
    };
    const result = studioGeometryAttributeMath({ a: scalars, op: "length" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("input-type-mismatch");
  });

  it("피연산자 속성의 원소 수가 모자라면 attribute-length-mismatch", () => {
    const short = {
      domain: "point" as const,
      itemSize: 3 as const,
      values: new Float32Array([1, 1, 1]),
    };
    const result = studioGeometryAttributeMath({ a: vectors, b: short, op: "add" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("attribute-length-mismatch");
  });

  it("위치 속성 왕복 — 연산 결과를 메시 위치로 되돌린다", () => {
    const grid = unwrap(studioGeometryGrid());
    const moved = unwrap(
      studioGeometryAttributeMath({
        a: studioGeometryPositionAttribute(grid),
        b: [0, 0, 2],
        op: "add",
      })
    );
    const out = unwrap(studioGeometryWithPositions(grid, moved));
    for (let i = 0; i < studioGeometryVertexCount(out); i++) {
      expect(out.positions[i * 3 + 2]).toBe(2);
    }
    expect(Array.from(out.indices)).toEqual(Array.from(grid.indices));
    expect(out.normals).not.toBeNull();
  });

  it("도메인/itemSize 가 안 맞는 속성을 위치로 되돌리면 거부한다", () => {
    const grid = unwrap(studioGeometryGrid());
    const scalar = {
      domain: "point" as const,
      itemSize: 1 as const,
      values: new Float32Array([1, 2, 3, 4]),
    };
    const result = studioGeometryWithPositions(grid, scalar);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("input-type-mismatch");
  });
});
