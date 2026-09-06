import { beforeAll, describe, expect, it } from "vitest";

import {
  loadStudioGeometryNodesPlanarBooleanBackend,
  studioGeometryBoundaryRings,
  studioGeometryMeshPlane,
  studioGeometryPlanarBoolean,
} from "./studio-geometry-nodes-boolean";
import {
  createStudioGeometryMesh,
  studioGeometryBoundaryEdges,
  studioGeometrySurfaceArea,
  studioGeometryTriangleCount,
  studioGeometryVertexCount,
} from "./studio-geometry-nodes-mesh";
import { studioGeometryTransform } from "./studio-geometry-nodes-ops";
import { studioGeometryCube, studioGeometryGrid } from "./studio-geometry-nodes-primitives";

import type { StudioGeometryNodesPlanarBooleanBackend } from "./studio-geometry-nodes-boolean";
import type { StudioGeometryMesh, StudioGeometryResult } from "./studio-geometry-nodes-mesh";

function unwrap<T>(result: StudioGeometryResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}: ${result.detail}`);
  return result.value;
}

/** [-1,1]² 정사각형(면적 4). */
const squareA = unwrap(studioGeometryGrid({ sizeX: 2, sizeY: 2 }));
/** [0,2]² 정사각형(면적 4) — A 와 [0,1]² 에서 겹친다. */
const squareB = unwrap(studioGeometryTransform(squareA, { translate: [1, 1, 0] }));

let backend: StudioGeometryNodesPlanarBooleanBackend;

beforeAll(async () => {
  // 스텁이 아니라 실제 polygon-clipping 을 로드한다(ESM default 폴백 경로까지 함께 검증).
  backend = await loadStudioGeometryNodesPlanarBooleanBackend();
});

describe("studio-geometry-nodes-boolean · 백엔드 로딩", () => {
  it("polygon-clipping 이 실제로 로드되고 동기 combine 을 제공한다", () => {
    expect(typeof backend.combine).toBe("function");
    const unit: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const result = backend.combine([[unit]], [[unit]], "union");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it("두 번 로드해도 같은 인스턴스를 재사용한다", async () => {
    expect(await loadStudioGeometryNodesPlanarBooleanBackend()).toBe(backend);
  });
});

describe("studio-geometry-nodes-boolean · 평면·링 추출", () => {
  it("XY 평면 격자의 평면 방정식은 법선 +Z, 오프셋 0", () => {
    const plane = unwrap(studioGeometryMeshPlane(squareA));
    expect(Array.from(plane.normal)).toEqual([0, 0, 1]);
    expect(plane.offset).toBe(0);
  });

  it("경계 링이 정확히 1개, 정점 4개다", () => {
    const rings = unwrap(studioGeometryBoundaryRings(squareA));
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it("비평면 메시는 non-planar 로 거부한다", () => {
    const bent = unwrap(
      createStudioGeometryMesh({
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 1]),
        indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      })
    );
    const result = studioGeometryMeshPlane(bent);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("non-planar");
  });

  it("닫힌 입체는 open-boundary 로 거부한다(경계 링이 없음)", () => {
    const welded = unwrap(studioGeometryGrid());
    expect(studioGeometryBoundaryEdges(welded).length).toBeGreaterThan(0);
    const closed = unwrap(
      createStudioGeometryMesh({
        // 사면체 — 닫혀 있어 경계 엣지가 0이다.
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
        indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]),
      })
    );
    expect(studioGeometryBoundaryEdges(closed)).toHaveLength(0);
    const result = studioGeometryBoundaryRings(closed);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("open-boundary");
  });
});

describe("studio-geometry-nodes-boolean · 연산 결과 수치 검증", () => {
  it("union — 면적 7, 정점 8, 삼각형 6 (L 자 팔각형)", () => {
    const out = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "union", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(7, 5);
    expect(studioGeometryVertexCount(out)).toBe(8);
    expect(studioGeometryTriangleCount(out)).toBe(6);
    for (let i = 0; i < studioGeometryVertexCount(out); i++) {
      expect(out.positions[i * 3 + 2]).toBeCloseTo(0, 6);
    }
  });

  it("intersection — 면적 1, 정점 4, 삼각형 2 ([0,1]² 정사각형)", () => {
    const out = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "intersection", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(1, 5);
    expect(studioGeometryVertexCount(out)).toBe(4);
    expect(studioGeometryTriangleCount(out)).toBe(2);
    const xs = Array.from({ length: 4 }, (_, i) => out.positions[i * 3]);
    const ys = Array.from({ length: 4 }, (_, i) => out.positions[i * 3 + 1]);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(1, 5);
    expect(Math.min(...ys)).toBeCloseTo(0, 5);
    expect(Math.max(...ys)).toBeCloseTo(1, 5);
  });

  it("difference — 면적 3, 정점 6, 삼각형 4 (A 에서 겹침을 판 L 자)", () => {
    const out = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "difference", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(3, 5);
    expect(studioGeometryVertexCount(out)).toBe(6);
    expect(studioGeometryTriangleCount(out)).toBe(4);
  });

  it("xor — 면적 6, 조각 두 개(정점 12 · 삼각형 8)", () => {
    const out = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "xor", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(6, 5);
    expect(studioGeometryVertexCount(out)).toBe(12);
    expect(studioGeometryTriangleCount(out)).toBe(8);
  });

  it("difference 는 방향이 있다 — B−A 는 A−B 와 다르지만 면적은 같다", () => {
    const ab = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "difference", { backend }));
    const ba = unwrap(studioGeometryPlanarBoolean(squareB, squareA, "difference", { backend }));
    expect(studioGeometrySurfaceArea(ba)).toBeCloseTo(3, 5);
    expect(Array.from(ba.positions)).not.toEqual(Array.from(ab.positions));
  });

  it("구멍이 뚫린 결과도 면적이 맞는다(큰 사각형 − 가운데 작은 사각형)", () => {
    const outer = unwrap(studioGeometryGrid({ sizeX: 6, sizeY: 6 }));
    const inner = unwrap(studioGeometryGrid({ sizeX: 2, sizeY: 2 }));
    const out = unwrap(studioGeometryPlanarBoolean(outer, inner, "difference", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(36 - 4, 4);
  });

  it("결정성 — 같은 입력은 두 번 실행해도 바이트 동일", () => {
    const a = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "union", { backend }));
    const b = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "union", { backend }));
    expect(Array.from(b.positions)).toEqual(Array.from(a.positions));
    expect(Array.from(b.indices)).toEqual(Array.from(a.indices));
  });

  it("결과 법선이 원 평면 법선(+Z)과 일치한다", () => {
    const out = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "union", { backend }));
    const normals = out.normals as Float32Array;
    for (let i = 0; i < studioGeometryVertexCount(out); i++) {
      expect(normals[i * 3 + 2]).toBeCloseTo(1, 5);
    }
  });

  it("XZ 평면(법선 −Y)에서도 동작한다 — 지배 축이 바뀌어도 재삼각화가 맞는다", () => {
    const rotatedA = unwrap(studioGeometryTransform(squareA, { rotate: [Math.PI / 2, 0, 0] }));
    const rotatedB = unwrap(studioGeometryTransform(squareB, { rotate: [Math.PI / 2, 0, 0] }));
    const out = unwrap(studioGeometryPlanarBoolean(rotatedA, rotatedB, "union", { backend }));
    expect(studioGeometrySurfaceArea(out)).toBeCloseTo(7, 4);
    for (let i = 0; i < studioGeometryVertexCount(out); i++) {
      expect(out.positions[i * 3 + 1]).toBeCloseTo(0, 5);
    }
  });
});

describe("studio-geometry-nodes-boolean · 거부 경로(가짜 결과 금지)", () => {
  it("백엔드가 없으면 boolean-backend-missing", () => {
    const result = studioGeometryPlanarBoolean(squareA, squareB, "union", { backend: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("boolean-backend-missing");
  });

  it("비평면 입력은 non-planar 로 거부한다(3D CSG 흉내를 내지 않음)", () => {
    const cube = unwrap(studioGeometryCube());
    const result = studioGeometryPlanarBoolean(cube, squareB, "union", { backend });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("non-planar");
  });

  it("평행하지만 다른 평면이면 coplanar-mismatch", () => {
    const lifted = unwrap(studioGeometryTransform(squareB, { translate: [0, 0, 1] }));
    const result = studioGeometryPlanarBoolean(squareA, lifted, "union", { backend });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("coplanar-mismatch");
  });

  it("법선이 평행하지 않으면 coplanar-mismatch", () => {
    const tilted = unwrap(studioGeometryTransform(squareB, { rotate: [Math.PI / 4, 0, 0] }));
    const result = studioGeometryPlanarBoolean(squareA, tilted, "union", { backend });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("coplanar-mismatch");
  });

  it("겹치지 않는 두 도형의 intersection 은 boolean-empty", () => {
    const far = unwrap(studioGeometryTransform(squareA, { translate: [100, 0, 0] }));
    const result = studioGeometryPlanarBoolean(squareA, far, "intersection", { backend });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("boolean-empty");
  });

  it("백엔드가 예외를 던져도 던지지 않고 boolean-backend-failed 로 수렴한다", () => {
    const throwing: StudioGeometryNodesPlanarBooleanBackend = {
      combine: () => {
        throw new Error("퇴화 입력");
      },
    };
    const result = studioGeometryPlanarBoolean(squareA, squareB, "union", { backend: throwing });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("boolean-backend-failed");
      expect(result.detail).toContain("퇴화 입력");
    }
  });

  it("백엔드가 빈 결과를 주면 boolean-empty", () => {
    const empty: StudioGeometryNodesPlanarBooleanBackend = { combine: () => [] };
    const result = studioGeometryPlanarBoolean(squareA, squareB, "union", { backend: empty });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("boolean-empty");
  });

  it("자기교차 링은 삼각화 검산에 걸려 triangulation-failed 로 거부한다", () => {
    // 부호 있는 넓이는 1 이지만 실제로 덮는 면적은 그보다 크다 — 면적 검산이 잡아낸다.
    const selfIntersecting: StudioGeometryNodesPlanarBooleanBackend = {
      combine: () => [
        [
          [
            [0, 0],
            [4, 0],
            [1, 3],
            [3, -1],
          ],
        ],
      ],
    };
    const result = studioGeometryPlanarBoolean(squareA, squareB, "union", {
      backend: selfIntersecting,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("triangulation-failed");
  });
});

describe("studio-geometry-nodes-boolean · 압출과의 합성", () => {
  it("불리언 결과를 압출하면 닫힌 입체가 된다(웹툰 배경 워크플로)", async () => {
    const { studioGeometryExtrude } = await import("./studio-geometry-nodes-ops");
    const merged = unwrap(studioGeometryPlanarBoolean(squareA, squareB, "union", { backend }));
    const solid: StudioGeometryMesh = unwrap(
      studioGeometryExtrude(merged, { distance: 0.5, capOriginal: true })
    );
    expect(studioGeometryBoundaryEdges(solid)).toHaveLength(0);
    // 위 7 + 아래 7 + 옆면 둘레 12 × 두께 0.5 = 20
    expect(studioGeometrySurfaceArea(solid)).toBeCloseTo(20, 3);
  });
});
