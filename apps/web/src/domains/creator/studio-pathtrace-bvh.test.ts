import { describe, expect, it } from "vitest";

import {
  STUDIO_PATHTRACE_BVH_MAX_DEPTH,
  STUDIO_PATHTRACE_BVH_MAX_LEAF,
  STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE,
  buildStudioPathtraceBvh,
  createStudioPathtraceTraversalStats,
  intersectStudioPathtraceBruteForce,
  intersectStudioPathtraceBvh,
  occludedStudioPathtraceBvh,
} from "./studio-pathtrace-bvh";
import {
  createStudioPathtraceHit,
  createStudioPathtraceRay,
  intersectStudioPathtraceAabb,
  intersectStudioPathtraceTriangle,
  setStudioPathtraceRayNormalized,
} from "./studio-pathtrace-geometry";
import { createRandomTriangleSoup, fixtureRandom } from "./studio-pathtrace-test-scenes";

import type { StudioPathtraceBvh } from "./studio-pathtrace-bvh";

function seededRay(seed: number, index: number) {
  const ray = createStudioPathtraceRay();
  const ox = fixtureRandom(seed, index * 11 + 1) * 16 - 8;
  const oy = fixtureRandom(seed, index * 11 + 2) * 16 - 8;
  const oz = fixtureRandom(seed, index * 11 + 3) * 16 - 8;
  const tx = fixtureRandom(seed, index * 11 + 4) * 10 - 5;
  const ty = fixtureRandom(seed, index * 11 + 5) * 10 - 5;
  const tz = fixtureRandom(seed, index * 11 + 6) * 10 - 5;
  setStudioPathtraceRayNormalized(ray, ox, oy, oz, tx - ox, ty - oy, tz - oz);
  return ray;
}

describe("buildStudioPathtraceBvh 불변식", () => {
  const cases = [200, 800, 2000];
  for (const triangleCount of cases) {
    it(`삼각형 ${triangleCount}개: 모든 삼각형이 triIndex 에 정확히 1회 나온다`, () => {
      const { positions, indices } = createRandomTriangleSoup(7, triangleCount);
      const bvh = buildStudioPathtraceBvh(positions, indices);
      const seen = new Uint8Array(triangleCount);
      for (let i = 0; i < bvh.triIndex.length; i += 1) {
        expect(bvh.triIndex[i]).toBeLessThan(triangleCount);
        seen[bvh.triIndex[i]] += 1;
      }
      expect(bvh.triIndex.length).toBe(triangleCount);
      for (let i = 0; i < triangleCount; i += 1) expect(seen[i]).toBe(1);
    });

    it(`삼각형 ${triangleCount}개: 리프 구간이 겹치지 않고 전체를 덮는다`, () => {
      const { positions, indices } = createRandomTriangleSoup(11, triangleCount);
      const bvh = buildStudioPathtraceBvh(positions, indices);
      const covered = new Uint8Array(triangleCount);
      let leaves = 0;
      for (let n = 0; n < bvh.nodeCount; n += 1) {
        const count = bvh.nodeMeta[n * 2 + 1];
        if (count === 0) continue;
        leaves += 1;
        expect(count).toBeLessThanOrEqual(STUDIO_PATHTRACE_BVH_MAX_LEAF);
        const first = bvh.nodeMeta[n * 2];
        for (let i = 0; i < count; i += 1) {
          expect(covered[first + i]).toBe(0);
          covered[first + i] = 1;
        }
      }
      expect(leaves).toBeGreaterThan(1);
      for (let i = 0; i < triangleCount; i += 1) expect(covered[i]).toBe(1);
    });
  }

  it("자식 바운즈는 부모 바운즈 안에 들어간다", () => {
    const { positions, indices } = createRandomTriangleSoup(3, 1000);
    const bvh = buildStudioPathtraceBvh(positions, indices);
    const eps = 1e-5;
    for (let n = 0; n < bvh.nodeCount; n += 1) {
      if (bvh.nodeMeta[n * 2 + 1] !== 0) continue;
      const left = bvh.nodeMeta[n * 2];
      for (const child of [left, left + 1]) {
        for (let a = 0; a < 3; a += 1) {
          expect(bvh.nodeBounds[child * 6 + a]).toBeGreaterThanOrEqual(bvh.nodeBounds[n * 6 + a] - eps);
          expect(bvh.nodeBounds[child * 6 + 3 + a]).toBeLessThanOrEqual(
            bvh.nodeBounds[n * 6 + 3 + a] + eps,
          );
        }
      }
    }
  });

  it("깊이는 상한 안이고 순회 스택을 넘길 수 없다", () => {
    const { positions, indices } = createRandomTriangleSoup(5, 2000);
    const bvh = buildStudioPathtraceBvh(positions, indices);
    expect(bvh.maxDepth).toBeLessThanOrEqual(STUDIO_PATHTRACE_BVH_MAX_DEPTH);
    expect(STUDIO_PATHTRACE_BVH_MAX_DEPTH * 2).toBeLessThan(STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE);
  });

  it("빈 지오메트리는 유효한 빈 BVH 를 만든다", () => {
    const bvh = buildStudioPathtraceBvh(new Float32Array(0), new Uint32Array(0));
    expect(bvh.triangleCount).toBe(0);
    expect(bvh.nodeCount).toBe(1);
    const ray = createStudioPathtraceRay();
    const hit = createStudioPathtraceHit();
    expect(
      intersectStudioPathtraceBvh(new Float32Array(0), new Uint32Array(0), bvh, ray, 0, Infinity, hit),
    ).toBe(false);
  });

  it("모든 중심점이 같아도(SAH 분할 불가) median 폴백으로 트리를 완성한다", () => {
    // 같은 중심점을 공유하는 삼각형 64개 — binned SAH 는 어떤 축에서도 분할면을 못 찾는다.
    const count = 64;
    const positions = new Float32Array(count * 9);
    const indices = new Uint32Array(count * 3);
    for (let t = 0; t < count; t += 1) {
      const s = 1 + t * 0.01;
      positions.set([-s, -s, 0, s, -s, 0, 0, s, 0], t * 9);
      indices.set([t * 3, t * 3 + 1, t * 3 + 2], t * 3);
    }
    const bvh = buildStudioPathtraceBvh(positions, indices);
    const seen = new Uint8Array(count);
    for (let i = 0; i < bvh.triIndex.length; i += 1) seen[bvh.triIndex[i]] += 1;
    for (let i = 0; i < count; i += 1) expect(seen[i]).toBe(1);
    expect(bvh.nodeCount).toBeGreaterThan(1);
  });
});

describe("buildStudioPathtraceBvh 결정성", () => {
  it("같은 입력을 두 번 빌드하면 바이트 단위로 동일하다", () => {
    const { positions, indices } = createRandomTriangleSoup(23, 1500);
    const a = buildStudioPathtraceBvh(positions, indices);
    const b = buildStudioPathtraceBvh(positions.slice(), indices.slice());
    expect(a.nodeCount).toBe(b.nodeCount);
    expect(a.maxDepth).toBe(b.maxDepth);
    expect(new Uint8Array(a.nodeBounds.buffer)).toEqual(new Uint8Array(b.nodeBounds.buffer));
    expect(new Uint8Array(a.nodeMeta.buffer)).toEqual(new Uint8Array(b.nodeMeta.buffer));
    expect(new Uint8Array(a.triIndex.buffer)).toEqual(new Uint8Array(b.triIndex.buffer));
  });
});

function compareAgainstBruteForce(
  positions: Float32Array,
  indices: Uint32Array,
  bvh: StudioPathtraceBvh,
  seed: number,
  rayCount: number,
): { hits: number } {
  const bvhHit = createStudioPathtraceHit();
  const bruteHit = createStudioPathtraceHit();
  let hits = 0;
  for (let r = 0; r < rayCount; r += 1) {
    const ray = seededRay(seed, r);
    intersectStudioPathtraceBvh(positions, indices, bvh, ray, 1e-6, Infinity, bvhHit);
    intersectStudioPathtraceBruteForce(positions, indices, ray, 1e-6, Infinity, bruteHit);
    expect(bvhHit.triangle, `ray ${r} 의 히트 삼각형이 다르다`).toBe(bruteHit.triangle);
    if (bruteHit.triangle >= 0) {
      hits += 1;
      const rel = Math.abs(bvhHit.t - bruteHit.t) / Math.max(1e-9, Math.abs(bruteHit.t));
      expect(rel, `ray ${r} 의 t 가 다르다`).toBeLessThan(1e-9);
      expect(bvhHit.u).toBeCloseTo(bruteHit.u, 12);
      expect(bvhHit.v).toBeCloseTo(bruteHit.v, 12);
    }
  }
  return { hits };
}

describe("intersectStudioPathtraceBvh 대 brute-force", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`시드 ${seed}: closest-hit 이 전수 검사와 완전히 일치한다`, () => {
      const triangleCount = 200 + seed * 300;
      const { positions, indices } = createRandomTriangleSoup(seed, triangleCount);
      const bvh = buildStudioPathtraceBvh(positions, indices);
      const { hits } = compareAgainstBruteForce(positions, indices, bvh, seed * 97, 200);
      // 실제로 히트가 충분히 있어야 비교가 의미 있다.
      expect(hits).toBeGreaterThan(20);
    });
  }

  it("any-hit(섀도)도 전수 검사 결과와 일치한다", () => {
    const { positions, indices } = createRandomTriangleSoup(13, 900);
    const bvh = buildStudioPathtraceBvh(positions, indices);
    const bruteHit = createStudioPathtraceHit();
    let occluded = 0;
    let clear = 0;
    for (let r = 0; r < 300; r += 1) {
      const ray = seededRay(1301, r);
      const tMax = 6 + (r % 5);
      const anyHit = occludedStudioPathtraceBvh(positions, indices, bvh, ray, 1e-6, tMax);
      intersectStudioPathtraceBruteForce(positions, indices, ray, 1e-6, tMax, bruteHit);
      const expected = bruteHit.triangle >= 0;
      expect(anyHit, `ray ${r}`).toBe(expected);
      if (expected) occluded += 1;
      else clear += 1;
    }
    expect(occluded).toBeGreaterThan(20);
    expect(clear).toBeGreaterThan(20);
  });
});

describe("BVH 품질 회귀", () => {
  it("고정 씬의 레이당 평균 노드 방문 수가 상한 아래다", () => {
    const { positions, indices } = createRandomTriangleSoup(31, 2000);
    const bvh = buildStudioPathtraceBvh(positions, indices);
    const stats = createStudioPathtraceTraversalStats();
    const hit = createStudioPathtraceHit();
    const rayCount = 500;
    for (let r = 0; r < rayCount; r += 1) {
      intersectStudioPathtraceBvh(
        positions,
        indices,
        bvh,
        seededRay(3101, r),
        1e-6,
        Infinity,
        hit,
        stats,
      );
    }
    const nodesPerRay = stats.nodeVisits / rayCount;
    const trisPerRay = stats.triangleTests / rayCount;
    // 전수 검사(2000 삼각형) 대비 두 자릿수 이상 적어야 SAH 가 일하고 있는 것이다.
    expect(trisPerRay).toBeLessThan(2000 / 10);
    // 실측 기준선(binned-SAH + front-to-back): 노드 ~60, 삼각형 ~50. 여유 2배로 고정.
    expect(nodesPerRay).toBeLessThan(140);
    expect(nodesPerRay).toBeGreaterThan(1);
  });

  it("front-to-back 정렬 순회가 고정 순서 순회보다 노드를 적게 본다", () => {
    // 참조 구현: 엔진과 동일하되 자식을 t 로 정렬하지 않고 항상 왼쪽부터 본다.
    // 두 순회의 히트 결과는 같아야 하고, 방문 노드 수만 정렬 쪽이 적어야 한다.
    function traverseUnsorted(
      pos: Float32Array,
      idx: Uint32Array,
      tree: StudioPathtraceBvh,
      ray: ReturnType<typeof createStudioPathtraceRay>,
      out: ReturnType<typeof createStudioPathtraceHit>,
      stats: ReturnType<typeof createStudioPathtraceTraversalStats>,
    ): void {
      out.t = -1;
      out.triangle = -1;
      const stack: number[] = [0];
      let best = Infinity;
      const bary = [0, 0];
      while (stack.length > 0) {
        const node = stack.pop() as number;
        stats.nodeVisits += 1;
        const lo = [tree.nodeBounds[node * 6], tree.nodeBounds[node * 6 + 1], tree.nodeBounds[node * 6 + 2]];
        const hi = [
          tree.nodeBounds[node * 6 + 3],
          tree.nodeBounds[node * 6 + 4],
          tree.nodeBounds[node * 6 + 5],
        ];
        if (intersectStudioPathtraceAabb(ray, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], 1e-6, best) < 0) {
          continue;
        }
        const count = tree.nodeMeta[node * 2 + 1];
        if (count > 0) {
          const first = tree.nodeMeta[node * 2];
          for (let i = 0; i < count; i += 1) {
            const tri = tree.triIndex[first + i];
            const i0 = idx[tri * 3] * 3;
            const i1 = idx[tri * 3 + 1] * 3;
            const i2 = idx[tri * 3 + 2] * 3;
            const t = intersectStudioPathtraceTriangle(
              ray,
              pos[i0], pos[i0 + 1], pos[i0 + 2],
              pos[i1], pos[i1 + 1], pos[i1 + 2],
              pos[i2], pos[i2 + 1], pos[i2 + 2],
              1e-6,
              best,
              bary,
            );
            if (t >= 0) {
              best = t;
              out.t = t;
              out.triangle = tri;
            }
          }
          continue;
        }
        const left = tree.nodeMeta[node * 2];
        stack.push(left + 1);
        stack.push(left);
      }
    }

    const { positions, indices } = createRandomTriangleSoup(41, 1500);
    const bvh = buildStudioPathtraceBvh(positions, indices);
    const sorted = createStudioPathtraceTraversalStats();
    const unsorted = createStudioPathtraceTraversalStats();
    const sortedHit = createStudioPathtraceHit();
    const unsortedHit = createStudioPathtraceHit();
    let compared = 0;
    for (let r = 0; r < 400; r += 1) {
      const ray = seededRay(4101, r);
      intersectStudioPathtraceBvh(positions, indices, bvh, ray, 1e-6, Infinity, sortedHit, sorted);
      traverseUnsorted(positions, indices, bvh, ray, unsortedHit, unsorted);
      expect(unsortedHit.triangle).toBe(sortedHit.triangle);
      compared += 1;
    }
    expect(compared).toBe(400);
    expect(sorted.nodeVisits).toBeLessThan(unsorted.nodeVisits);
    // 정렬 순회의 실측 우위를 숫자로 잠근다(회귀 시 여기서 걸린다).
    const gain = unsorted.nodeVisits / sorted.nodeVisits;
    expect(gain, `노드 방문 감소 배수 = ${gain}`).toBeGreaterThan(1.5);
  });
});
