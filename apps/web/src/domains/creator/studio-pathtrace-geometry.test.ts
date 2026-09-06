import { describe, expect, it } from "vitest";

import {
  createStudioPathtraceRay,
  intersectStudioPathtraceAabb,
  intersectStudioPathtraceParallelogram,
  intersectStudioPathtraceTriangle,
  setStudioPathtraceRay,
  setStudioPathtraceRayNormalized,
  studioPathtraceGeometricNormal,
  studioPathtraceInterpolate3,
} from "./studio-pathtrace-geometry";
import { createSharedEdgeGrid } from "./studio-pathtrace-test-scenes";

describe("intersectStudioPathtraceAabb", () => {
  it("정면 히트에서 진입 t 를 정확히 돌려준다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0, 0, -5, 0, 0, 1);
    const t = intersectStudioPathtraceAabb(ray, -1, -1, -1, 1, 1, 1, 0, Infinity);
    expect(t).toBeCloseTo(4, 10);
  });

  it("박스 안에서 출발하면 tMin 을 돌려준다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0, 0, 0, 0, 0, 1);
    expect(intersectStudioPathtraceAabb(ray, -1, -1, -1, 1, 1, 1, 0, Infinity)).toBe(0);
  });

  it("빗나가면 -1", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 5, 5, -5, 0, 0, 1);
    expect(intersectStudioPathtraceAabb(ray, -1, -1, -1, 1, 1, 1, 0, Infinity)).toBe(-1);
  });

  it("뒤쪽 박스는 tMin 으로 잘린다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0, 0, 5, 0, 0, 1);
    expect(intersectStudioPathtraceAabb(ray, -1, -1, -1, 1, 1, 1, 0, Infinity)).toBe(-1);
  });

  it("축 평행(0 성분) 방향 — 슬랩 안쪽에서 출발하면 히트한다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, -5, 2, 0, 1, 0, 0);
    const t = intersectStudioPathtraceAabb(ray, -1, 1, -1, 1, 3, 1, 0, Infinity);
    expect(t).toBeCloseTo(4, 6);
  });

  it("축 평행 레이가 슬랩 경계면에 정확히 놓여도 히트를 떨어뜨리지 않는다", () => {
    // idy = ±Infinity 였다면 (1 - 1) * Inf = NaN 이 되어 히트가 조용히 사라진다.
    // 포화 역수(±1e18)라 0 * 1e18 = 0 이 되어 슬랩이 열린 것으로 보수 처리된다.
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, -5, 1, 0, 1, 0, 0);
    expect(Number.isFinite(ray.idy)).toBe(true);
    const t = intersectStudioPathtraceAabb(ray, -1, 1, -1, 1, 3, 1, 0, Infinity);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeCloseTo(4, 6);
  });

  it("축 평행 레이가 슬랩 완전히 밖이면 여전히 미스한다(보수 처리가 전부를 통과시키지 않는다)", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, -5, 9, 0, 1, 0, 0);
    expect(intersectStudioPathtraceAabb(ray, -1, 1, -1, 1, 3, 1, 0, Infinity)).toBe(-1);
  });

  it("tMax 보다 먼 박스는 거부한다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0, 0, -5, 0, 0, 1);
    expect(intersectStudioPathtraceAabb(ray, -1, -1, -1, 1, 1, 1, 0, 3)).toBe(-1);
  });
});

describe("intersectStudioPathtraceTriangle", () => {
  it("알려진 t 와 무게중심 좌표를 돌려준다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0.25, 0.25, -2, 0, 0, 1);
    const bary = [0, 0];
    const t = intersectStudioPathtraceTriangle(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, Infinity, bary);
    expect(t).toBeCloseTo(2, 10);
    expect(bary[0]).toBeCloseTo(0.25, 10);
    expect(bary[1]).toBeCloseTo(0.25, 10);
  });

  it("삼각형 밖은 미스", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0.9, 0.9, -2, 0, 0, 1);
    const bary = [0, 0];
    expect(intersectStudioPathtraceTriangle(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, Infinity, bary)).toBe(-1);
  });

  it("뒷면도 히트한다(백페이스 컬링 없음)", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0.25, 0.25, 2, 0, 0, -1);
    const bary = [0, 0];
    expect(
      intersectStudioPathtraceTriangle(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, Infinity, bary),
    ).toBeCloseTo(2, 10);
  });

  it("tMin/tMax 구간 밖은 거부한다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0.25, 0.25, -2, 0, 0, 1);
    const bary = [0, 0];
    expect(intersectStudioPathtraceTriangle(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2.5, Infinity, bary)).toBe(-1);
    expect(intersectStudioPathtraceTriangle(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1.5, bary)).toBe(-1);
  });

  it("퇴화 삼각형(면적 0)은 미스", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0.25, 0, -2, 0, 0, 1);
    const bary = [0, 0];
    expect(intersectStudioPathtraceTriangle(ray, 0, 0, 0, 1, 0, 0, 2, 0, 0, 0, Infinity, bary)).toBe(-1);
  });
});

describe("watertight — 공유 edge 에서 구멍이 생기지 않는다", () => {
  function sweep(cells: number, rays: number, originZ: number): { hits: number; total: number } {
    const { positions, indices } = createSharedEdgeGrid(cells);
    const triangleCount = indices.length / 3;
    const ray = createStudioPathtraceRay();
    const bary = [0, 0];
    let hits = 0;
    let total = 0;
    for (let j = 0; j < rays; j += 1) {
      for (let i = 0; i < rays; i += 1) {
        // 격자 정점/edge 위를 정확히 지나가도록 샘플 위치를 정렬한다.
        const x = -0.5 + i / (rays - 1);
        const y = -0.5 + j / (rays - 1);
        setStudioPathtraceRayNormalized(ray, x, y, originZ, 0, 0, originZ < 0 ? 1 : -1);
        let hit = false;
        for (let t = 0; t < triangleCount && !hit; t += 1) {
          const i0 = indices[t * 3] * 3;
          const i1 = indices[t * 3 + 1] * 3;
          const i2 = indices[t * 3 + 2] * 3;
          const tHit = intersectStudioPathtraceTriangle(
            ray,
            positions[i0],
            positions[i0 + 1],
            positions[i0 + 2],
            positions[i1],
            positions[i1 + 1],
            positions[i1 + 2],
            positions[i2],
            positions[i2 + 1],
            positions[i2 + 2],
            1e-6,
            Infinity,
            bary,
          );
          if (tHit >= 0) hit = true;
        }
        total += 1;
        if (hit) hits += 1;
      }
    }
    return { hits, total };
  }

  it("32×32 격자에 129×129 레이 스윕 — dropped hit 0건", () => {
    // rays = cells*4 + 1 이라 샘플 좌표가 격자 정점/edge(축 정렬 + 사선)를 정확히 밟는다.
    const { hits, total } = sweep(32, 129, -3);
    expect(total).toBe(129 * 129);
    expect(total - hits).toBe(0);
  });

  it("반대 방향(뒷면)에서도 dropped hit 0건", () => {
    const { hits, total } = sweep(32, 129, 3);
    expect(total - hits).toBe(0);
  });

  it("격자 밖 레이는 정상적으로 미스한다(위 단언이 공허하지 않다는 확인)", () => {
    const { positions, indices } = createSharedEdgeGrid(8);
    const ray = createStudioPathtraceRay();
    const bary = [0, 0];
    setStudioPathtraceRay(ray, 5, 5, -3, 0, 0, 1);
    let hit = false;
    for (let t = 0; t < indices.length / 3; t += 1) {
      const i0 = indices[t * 3] * 3;
      const i1 = indices[t * 3 + 1] * 3;
      const i2 = indices[t * 3 + 2] * 3;
      if (
        intersectStudioPathtraceTriangle(
          ray,
          positions[i0],
          positions[i0 + 1],
          positions[i0 + 2],
          positions[i1],
          positions[i1 + 1],
          positions[i1 + 2],
          positions[i2],
          positions[i2 + 1],
          positions[i2 + 2],
          1e-6,
          Infinity,
          bary,
        ) >= 0
      ) {
        hit = true;
      }
    }
    expect(hit).toBe(false);
  });
});

describe("intersectStudioPathtraceParallelogram", () => {
  it("사각형 안쪽 히트의 t 와 uv 가 맞다", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0.25, 0.75, -4, 0, 0, 1);
    const uv = [0, 0];
    const t = intersectStudioPathtraceParallelogram(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, Infinity, uv);
    expect(t).toBeCloseTo(4, 10);
    expect(uv[0]).toBeCloseTo(0.25, 10);
    expect(uv[1]).toBeCloseTo(0.75, 10);
  });

  it("삼각형이 아니라 사각형 전체를 덮는다(u+v>1 도 히트)", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 0.9, 0.9, -4, 0, 0, 1);
    const uv = [0, 0];
    expect(
      intersectStudioPathtraceParallelogram(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, Infinity, uv),
    ).toBeCloseTo(4, 10);
  });

  it("사각형 밖은 미스", () => {
    const ray = createStudioPathtraceRay();
    setStudioPathtraceRay(ray, 1.1, 0.5, -4, 0, 0, 1);
    const uv = [0, 0];
    expect(intersectStudioPathtraceParallelogram(ray, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, Infinity, uv)).toBe(-1);
  });
});

describe("법선/보간 유틸", () => {
  it("지오메트릭 노멀은 오른손 법칙 방향의 단위 벡터다", () => {
    const out = [0, 0, 0];
    studioPathtraceGeometricNormal(0, 0, 0, 1, 0, 0, 0, 1, 0, out);
    expect(out[0]).toBeCloseTo(0, 12);
    expect(out[1]).toBeCloseTo(0, 12);
    expect(out[2]).toBeCloseTo(1, 12);
  });

  it("퇴화 삼각형은 [0,0,1] 로 폴백한다", () => {
    const out = [0, 0, 0];
    studioPathtraceGeometricNormal(0, 0, 0, 1, 0, 0, 2, 0, 0, out);
    expect([out[0], out[1], out[2]]).toEqual([0, 0, 1]);
  });

  it("무게중심 보간은 꼭짓점에서 정확히 그 값을 준다", () => {
    const out = [0, 0, 0];
    studioPathtraceInterpolate3(0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, out);
    expect([out[0], out[1], out[2]]).toEqual([1, 2, 3]);
    studioPathtraceInterpolate3(1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, out);
    expect([out[0], out[1], out[2]]).toEqual([4, 5, 6]);
    studioPathtraceInterpolate3(0, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, out);
    expect([out[0], out[1], out[2]]).toEqual([7, 8, 9]);
  });
});
