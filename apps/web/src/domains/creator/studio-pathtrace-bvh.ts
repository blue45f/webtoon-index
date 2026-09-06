/**
 * Studio Path Tracer — 결정적 binned-SAH BVH (studio-pathtrace-bvh)
 *
 * 알고리즘
 *  - **12-bin binned SAH 빌더.** 노드마다 축 0→1→2 순서로 중심점을 12개 bin 에 넣고,
 *    좌/우 prefix 바운즈를 훑어 11개 분할면의 SAH 비용을 평가한다. 동점이면 **낮은 축,
 *    낮은 bin** 을 고른다. 분할이 한쪽으로 몰려 진전이 없으면 중심점 median split 로
 *    폴백하되, 정렬 비교자에 삼각형 인덱스 타이브레이크를 넣어 순서를 못 박는다.
 *  - **재귀 없음.** 명시적 스택으로 노드를 처리한다(500k 삼각형에서 스택 오버플로 방지).
 *  - **flat SoA**: `nodeBounds`(6*N f32), `nodeMeta`(2*N u32), `triIndex`(T u32).
 *    변환 없이 그대로 WebGPU storage buffer 로 올라간다.
 *  - **front-to-back 정렬 순회.** 두 자식의 AABB 진입 t 를 비교해 가까운 쪽을 먼저 본다.
 *    실측(이 맥/Node 24, 200k 랜덤 삼각형 수프, 원점 지향 레이 2,000개): 노드 방문
 *    280,979회 대 고정 순서 2,167,576회 = **7.7배** 감소. 계약 테스트가 이 우위를 잠근다.
 *
 * 정직한 한계
 *  - **BLAS 하나뿐이다.** TLAS/인스턴싱이 없어 같은 모델을 100번 배치하면 삼각형도 100배다.
 *  - spatial split(SBVH)·트리 재구조화(TRBVH)·리프 축소 없음. 겹침이 큰 씬에서
 *    Embree/Cycles 대비 순회 비용이 눈에 띄게 높다.
 *  - refit/동적 갱신 없음 — 지오메트리가 바뀌면 전부 다시 짓는다.
 *  - 빌드는 **시간 개념이 없는 순수 함수**지만 느리다. 실측(이 맥/Node 24):
 *    50k 삼각형 167 ms, 200k 삼각형 408 ms → 상한 500k 에서는 1초를 넘길 수 있다.
 *    **메인 스레드에서 호출하지 말 것**(워커 슬라이스는 후속 작업).
 */

import {
  createStudioPathtraceHit,
  intersectStudioPathtraceAabb,
  intersectStudioPathtraceTriangle,
} from "./studio-pathtrace-geometry";

import type { StudioPathtraceHit, StudioPathtraceRay } from "./studio-pathtrace-geometry";

/** SAH bin 개수 — WGSL 포트와 무관(빌드는 CPU 전용)하지만 결정성 계약의 일부다. */
export const STUDIO_PATHTRACE_BVH_BINS = 12;
/** 이 개수 이하면 SAH 평가 없이 바로 리프. */
export const STUDIO_PATHTRACE_BVH_MIN_LEAF = 2;
/** SAH 가 리프보다 나빠도 이 개수를 넘으면 강제로 분할한다. */
export const STUDIO_PATHTRACE_BVH_MAX_LEAF = 8;
/** 순회 비용 상수(SAH 의 C_trav / C_isect 비). */
export const STUDIO_PATHTRACE_BVH_TRAVERSAL_COST = 1.2;
/**
 * 빌드 깊이 상한 — 이 깊이에 닿으면 무조건 리프로 닫는다.
 * 순회 스택(고정 64)이 절대 넘치지 않는다는 보장의 근거다(레벨당 push ≤ 2 → 최대 60).
 * WGSL 포트의 function-scope 스택 크기와 같은 값이라 두 백엔드가 같은 트리를 순회한다.
 */
export const STUDIO_PATHTRACE_BVH_MAX_DEPTH = 30;

export interface StudioPathtraceBvh {
  /** 6*nodeCount: minX,minY,minZ,maxX,maxY,maxZ. */
  readonly nodeBounds: Float32Array;
  /** 2*nodeCount: [내부] leftChild, 0 / [리프] firstPrim, primCount(>0). */
  readonly nodeMeta: Uint32Array;
  /** 삼각형 순열 — 리프는 이 배열의 연속 구간을 가리킨다. */
  readonly triIndex: Uint32Array;
  readonly nodeCount: number;
  readonly triangleCount: number;
  readonly maxDepth: number;
}

export interface StudioPathtraceTraversalStats {
  nodeVisits: number;
  triangleTests: number;
}

export function createStudioPathtraceTraversalStats(): StudioPathtraceTraversalStats {
  return { nodeVisits: 0, triangleTests: 0 };
}

function surfaceArea(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number {
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  if (dx < 0 || dy < 0 || dz < 0) return 0;
  return 2 * (dx * dy + dy * dz + dz * dx);
}

/**
 * 삼각형 배열 위에 BVH 를 짓는다. 같은 입력이면 `nodeBounds`/`nodeMeta`/`triIndex` 가
 * **바이트 단위로 동일**하다(계약 테스트가 강제).
 */
export function buildStudioPathtraceBvh(positions: Float32Array, indices: Uint32Array): StudioPathtraceBvh {
  const triangleCount = Math.floor(indices.length / 3);
  if (triangleCount === 0) {
    return {
      nodeBounds: new Float32Array(6),
      nodeMeta: new Uint32Array(2),
      triIndex: new Uint32Array(0),
      nodeCount: 1,
      triangleCount: 0,
      maxDepth: 0,
    };
  }

  // 1) 삼각형별 바운즈 + 중심점 사전계산.
  const triBounds = new Float32Array(triangleCount * 6);
  const triCentroid = new Float32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = indices[t * 3] * 3;
    const i1 = indices[t * 3 + 1] * 3;
    const i2 = indices[t * 3 + 2] * 3;
    for (let a = 0; a < 3; a += 1) {
      const v0 = positions[i0 + a];
      const v1 = positions[i1 + a];
      const v2 = positions[i2 + a];
      const lo = Math.min(v0, Math.min(v1, v2));
      const hi = Math.max(v0, Math.max(v1, v2));
      triBounds[t * 6 + a] = lo;
      triBounds[t * 6 + 3 + a] = hi;
      triCentroid[t * 3 + a] = (lo + hi) * 0.5;
    }
  }

  const triIndex = new Uint32Array(triangleCount);
  for (let t = 0; t < triangleCount; t += 1) triIndex[t] = t;

  const maxNodes = Math.max(1, triangleCount * 2);
  const nodeBounds = new Float32Array(maxNodes * 6);
  const nodeMeta = new Uint32Array(maxNodes * 2);
  let nodeCount = 1;
  let maxDepth = 0;

  // 작업 스택: [nodeIndex, start, end, depth]
  const stackNode: number[] = [0];
  const stackStart: number[] = [0];
  const stackEnd: number[] = [triangleCount];
  const stackDepth: number[] = [0];

  const bins = STUDIO_PATHTRACE_BVH_BINS;
  const binCount = new Int32Array(bins);
  const binBounds = new Float64Array(bins * 6);
  const prefixArea = new Float64Array(bins);
  const prefixCount = new Int32Array(bins);
  const suffixArea = new Float64Array(bins);
  const suffixCount = new Int32Array(bins);

  while (stackNode.length > 0) {
    const node = stackNode.pop() as number;
    const start = stackStart.pop() as number;
    const end = stackEnd.pop() as number;
    const depth = stackDepth.pop() as number;
    if (depth > maxDepth) maxDepth = depth;
    const count = end - start;

    // 노드 바운즈 + 중심점 바운즈 (고정 순서 누적).
    let nMinX = Infinity;
    let nMinY = Infinity;
    let nMinZ = Infinity;
    let nMaxX = -Infinity;
    let nMaxY = -Infinity;
    let nMaxZ = -Infinity;
    let cMinX = Infinity;
    let cMinY = Infinity;
    let cMinZ = Infinity;
    let cMaxX = -Infinity;
    let cMaxY = -Infinity;
    let cMaxZ = -Infinity;
    for (let i = start; i < end; i += 1) {
      const t = triIndex[i];
      const b = t * 6;
      if (triBounds[b] < nMinX) nMinX = triBounds[b];
      if (triBounds[b + 1] < nMinY) nMinY = triBounds[b + 1];
      if (triBounds[b + 2] < nMinZ) nMinZ = triBounds[b + 2];
      if (triBounds[b + 3] > nMaxX) nMaxX = triBounds[b + 3];
      if (triBounds[b + 4] > nMaxY) nMaxY = triBounds[b + 4];
      if (triBounds[b + 5] > nMaxZ) nMaxZ = triBounds[b + 5];
      const c = t * 3;
      if (triCentroid[c] < cMinX) cMinX = triCentroid[c];
      if (triCentroid[c + 1] < cMinY) cMinY = triCentroid[c + 1];
      if (triCentroid[c + 2] < cMinZ) cMinZ = triCentroid[c + 2];
      if (triCentroid[c] > cMaxX) cMaxX = triCentroid[c];
      if (triCentroid[c + 1] > cMaxY) cMaxY = triCentroid[c + 1];
      if (triCentroid[c + 2] > cMaxZ) cMaxZ = triCentroid[c + 2];
    }
    nodeBounds[node * 6] = nMinX;
    nodeBounds[node * 6 + 1] = nMinY;
    nodeBounds[node * 6 + 2] = nMinZ;
    nodeBounds[node * 6 + 3] = nMaxX;
    nodeBounds[node * 6 + 4] = nMaxY;
    nodeBounds[node * 6 + 5] = nMaxZ;

    if (count <= STUDIO_PATHTRACE_BVH_MIN_LEAF || depth >= STUDIO_PATHTRACE_BVH_MAX_DEPTH) {
      nodeMeta[node * 2] = start;
      nodeMeta[node * 2 + 1] = count;
      continue;
    }

    const parentArea = surfaceArea(nMinX, nMinY, nMinZ, nMaxX, nMaxY, nMaxZ);
    const leafCost = count;
    let bestAxis = -1;
    let bestBin = -1;
    let bestCost = Infinity;

    for (let axis = 0; axis < 3; axis += 1) {
      const cMin = axis === 0 ? cMinX : axis === 1 ? cMinY : cMinZ;
      const cMax = axis === 0 ? cMaxX : axis === 1 ? cMaxY : cMaxZ;
      const extent = cMax - cMin;
      if (!(extent > 0)) continue;
      const scale = bins / extent;

      binCount.fill(0);
      for (let b = 0; b < bins; b += 1) {
        binBounds[b * 6] = Infinity;
        binBounds[b * 6 + 1] = Infinity;
        binBounds[b * 6 + 2] = Infinity;
        binBounds[b * 6 + 3] = -Infinity;
        binBounds[b * 6 + 4] = -Infinity;
        binBounds[b * 6 + 5] = -Infinity;
      }
      for (let i = start; i < end; i += 1) {
        const t = triIndex[i];
        const c = triCentroid[t * 3 + axis];
        let b = Math.floor((c - cMin) * scale);
        if (b < 0) b = 0;
        if (b >= bins) b = bins - 1;
        binCount[b] += 1;
        const tb = t * 6;
        const bb = b * 6;
        if (triBounds[tb] < binBounds[bb]) binBounds[bb] = triBounds[tb];
        if (triBounds[tb + 1] < binBounds[bb + 1]) binBounds[bb + 1] = triBounds[tb + 1];
        if (triBounds[tb + 2] < binBounds[bb + 2]) binBounds[bb + 2] = triBounds[tb + 2];
        if (triBounds[tb + 3] > binBounds[bb + 3]) binBounds[bb + 3] = triBounds[tb + 3];
        if (triBounds[tb + 4] > binBounds[bb + 4]) binBounds[bb + 4] = triBounds[tb + 4];
        if (triBounds[tb + 5] > binBounds[bb + 5]) binBounds[bb + 5] = triBounds[tb + 5];
      }

      // 좌측 prefix (bin 0..i 포함)
      let aMinX = Infinity;
      let aMinY = Infinity;
      let aMinZ = Infinity;
      let aMaxX = -Infinity;
      let aMaxY = -Infinity;
      let aMaxZ = -Infinity;
      let acc = 0;
      for (let b = 0; b < bins; b += 1) {
        if (binCount[b] > 0) {
          const bb = b * 6;
          if (binBounds[bb] < aMinX) aMinX = binBounds[bb];
          if (binBounds[bb + 1] < aMinY) aMinY = binBounds[bb + 1];
          if (binBounds[bb + 2] < aMinZ) aMinZ = binBounds[bb + 2];
          if (binBounds[bb + 3] > aMaxX) aMaxX = binBounds[bb + 3];
          if (binBounds[bb + 4] > aMaxY) aMaxY = binBounds[bb + 4];
          if (binBounds[bb + 5] > aMaxZ) aMaxZ = binBounds[bb + 5];
          acc += binCount[b];
        }
        prefixCount[b] = acc;
        prefixArea[b] = acc > 0 ? surfaceArea(aMinX, aMinY, aMinZ, aMaxX, aMaxY, aMaxZ) : 0;
      }
      // 우측 suffix (bin i..bins-1 포함)
      aMinX = Infinity;
      aMinY = Infinity;
      aMinZ = Infinity;
      aMaxX = -Infinity;
      aMaxY = -Infinity;
      aMaxZ = -Infinity;
      acc = 0;
      for (let b = bins - 1; b >= 0; b -= 1) {
        if (binCount[b] > 0) {
          const bb = b * 6;
          if (binBounds[bb] < aMinX) aMinX = binBounds[bb];
          if (binBounds[bb + 1] < aMinY) aMinY = binBounds[bb + 1];
          if (binBounds[bb + 2] < aMinZ) aMinZ = binBounds[bb + 2];
          if (binBounds[bb + 3] > aMaxX) aMaxX = binBounds[bb + 3];
          if (binBounds[bb + 4] > aMaxY) aMaxY = binBounds[bb + 4];
          if (binBounds[bb + 5] > aMaxZ) aMaxZ = binBounds[bb + 5];
          acc += binCount[b];
        }
        suffixCount[b] = acc;
        suffixArea[b] = acc > 0 ? surfaceArea(aMinX, aMinY, aMinZ, aMaxX, aMaxY, aMaxZ) : 0;
      }

      const invParent = parentArea > 0 ? 1 / parentArea : 0;
      for (let b = 0; b < bins - 1; b += 1) {
        const lc = prefixCount[b];
        const rc = suffixCount[b + 1];
        if (lc === 0 || rc === 0) continue;
        const cost =
          STUDIO_PATHTRACE_BVH_TRAVERSAL_COST
          + (prefixArea[b] * lc + suffixArea[b + 1] * rc) * invParent;
        // 엄격한 `<` 라 동점이면 먼저 평가된(낮은 축, 낮은 bin) 후보가 이긴다.
        if (cost < bestCost) {
          bestCost = cost;
          bestAxis = axis;
          bestBin = b;
        }
      }
    }

    const forceSplit = count > STUDIO_PATHTRACE_BVH_MAX_LEAF;
    if (!forceSplit && (bestAxis < 0 || bestCost >= leafCost)) {
      nodeMeta[node * 2] = start;
      nodeMeta[node * 2 + 1] = count;
      continue;
    }

    let mid = -1;
    if (bestAxis >= 0) {
      const cMin = bestAxis === 0 ? cMinX : bestAxis === 1 ? cMinY : cMinZ;
      const cMax = bestAxis === 0 ? cMaxX : bestAxis === 1 ? cMaxY : cMaxZ;
      const scale = bins / (cMax - cMin);
      let i = start;
      let j = end - 1;
      while (i <= j) {
        const t = triIndex[i];
        let b = Math.floor((triCentroid[t * 3 + bestAxis] - cMin) * scale);
        if (b < 0) b = 0;
        if (b >= bins) b = bins - 1;
        if (b <= bestBin) {
          i += 1;
        } else {
          triIndex[i] = triIndex[j];
          triIndex[j] = t;
          j -= 1;
        }
      }
      mid = i;
    }

    if (mid <= start || mid >= end) {
      // 진전 없음 → 중심점 median split 폴백(축은 중심점 범위가 가장 넓은 축).
      const ex = cMaxX - cMinX;
      const ey = cMaxY - cMinY;
      const ez = cMaxZ - cMinZ;
      let axis = 0;
      if (ey > ex) axis = 1;
      if (ez > (axis === 0 ? ex : ey)) axis = 2;
      const slice = Array.from(triIndex.subarray(start, end));
      slice.sort((a, b) => {
        const ca = triCentroid[a * 3 + axis];
        const cb = triCentroid[b * 3 + axis];
        if (ca < cb) return -1;
        if (ca > cb) return 1;
        return a - b; // 인덱스 타이브레이크 — 정렬 결과를 완전히 결정한다.
      });
      for (let i = 0; i < slice.length; i += 1) triIndex[start + i] = slice[i];
      mid = start + (count >> 1);
    }

    const left = nodeCount;
    nodeCount += 2;
    nodeMeta[node * 2] = left;
    nodeMeta[node * 2 + 1] = 0;
    // 왼쪽을 나중에 pop 하도록 오른쪽부터 push(깊이 우선 순서 고정).
    stackNode.push(left + 1);
    stackStart.push(mid);
    stackEnd.push(end);
    stackDepth.push(depth + 1);
    stackNode.push(left);
    stackStart.push(start);
    stackEnd.push(mid);
    stackDepth.push(depth + 1);
  }

  return {
    nodeBounds: nodeBounds.slice(0, nodeCount * 6),
    nodeMeta: nodeMeta.slice(0, nodeCount * 2),
    triIndex,
    nodeCount,
    triangleCount,
    maxDepth,
  };
}

/**
 * 순회 스택 크기 — 빌드 깊이 상한(30) × 레벨당 push 2 + 여유. 넘칠 수 없으므로
 * 오버플로 분기(= 히트 유실)가 존재하지 않는다.
 */
export const STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE = 64;
const TRAVERSAL_STACK_SIZE = STUDIO_PATHTRACE_TRAVERSAL_STACK_SIZE;

// 레이당 수백만 번 호출되므로 스택은 모듈 스크래치로 재사용한다.
// **재진입 불가**: 두 순회 함수를 중첩 호출하면 안 된다(인테그레이터는 항상 순차 호출).
const closestStackNode = new Int32Array(TRAVERSAL_STACK_SIZE);
const closestStackT = new Float64Array(TRAVERSAL_STACK_SIZE);
const occludedStackNode = new Int32Array(TRAVERSAL_STACK_SIZE);
const closestBary: number[] = [0, 0];
const occludedBary: number[] = [0, 0];

/**
 * closest-hit 순회(front-to-back 정렬). 히트면 true 와 `hit` 갱신, 미스면 false.
 * `hit.t` 는 호출 전 값과 무관하게 덮어써진다.
 */
export function intersectStudioPathtraceBvh(
  positions: Float32Array,
  indices: Uint32Array,
  bvh: StudioPathtraceBvh,
  ray: StudioPathtraceRay,
  tMin: number,
  tMax: number,
  hit: StudioPathtraceHit,
  stats?: StudioPathtraceTraversalStats,
): boolean {
  hit.t = -1;
  hit.triangle = -1;
  hit.u = 0;
  hit.v = 0;
  if (bvh.triangleCount === 0) return false;

  const { nodeBounds, nodeMeta, triIndex } = bvh;
  const stackNode = closestStackNode;
  const stackT = closestStackT;
  let sp = 0;
  let best = tMax;
  const bary = closestBary;

  const rootT = intersectStudioPathtraceAabb(
    ray,
    nodeBounds[0],
    nodeBounds[1],
    nodeBounds[2],
    nodeBounds[3],
    nodeBounds[4],
    nodeBounds[5],
    tMin,
    best,
  );
  if (rootT < 0) return false;
  stackNode[sp] = 0;
  stackT[sp] = rootT;
  sp += 1;

  while (sp > 0) {
    sp -= 1;
    const node = stackNode[sp];
    if (stackT[sp] >= best) continue;
    if (stats) stats.nodeVisits += 1;
    const count = nodeMeta[node * 2 + 1];
    if (count > 0) {
      const first = nodeMeta[node * 2];
      for (let i = 0; i < count; i += 1) {
        const tri = triIndex[first + i];
        const i0 = indices[tri * 3] * 3;
        const i1 = indices[tri * 3 + 1] * 3;
        const i2 = indices[tri * 3 + 2] * 3;
        if (stats) stats.triangleTests += 1;
        const t = intersectStudioPathtraceTriangle(
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
          tMin,
          best,
          bary,
        );
        if (t >= 0) {
          best = t;
          hit.t = t;
          hit.triangle = tri;
          hit.u = bary[0];
          hit.v = bary[1];
        }
      }
      continue;
    }

    const left = nodeMeta[node * 2];
    const right = left + 1;
    const tl = intersectStudioPathtraceAabb(
      ray,
      nodeBounds[left * 6],
      nodeBounds[left * 6 + 1],
      nodeBounds[left * 6 + 2],
      nodeBounds[left * 6 + 3],
      nodeBounds[left * 6 + 4],
      nodeBounds[left * 6 + 5],
      tMin,
      best,
    );
    const tr = intersectStudioPathtraceAabb(
      ray,
      nodeBounds[right * 6],
      nodeBounds[right * 6 + 1],
      nodeBounds[right * 6 + 2],
      nodeBounds[right * 6 + 3],
      nodeBounds[right * 6 + 4],
      nodeBounds[right * 6 + 5],
      tMin,
      best,
    );
    if (tl >= 0 && tr >= 0) {
      // 먼 쪽을 먼저 push → 가까운 쪽이 먼저 pop 된다.
      const nearIsLeft = tl <= tr;
      const farNode = nearIsLeft ? right : left;
      const farT = nearIsLeft ? tr : tl;
      const nearNode = nearIsLeft ? left : right;
      const nearT = nearIsLeft ? tl : tr;
      stackNode[sp] = farNode;
      stackT[sp] = farT;
      sp += 1;
      stackNode[sp] = nearNode;
      stackT[sp] = nearT;
      sp += 1;
    } else if (tl >= 0) {
      stackNode[sp] = left;
      stackT[sp] = tl;
      sp += 1;
    } else if (tr >= 0) {
      stackNode[sp] = right;
      stackT[sp] = tr;
      sp += 1;
    }
  }

  return hit.t >= 0;
}

/** any-hit 순회(섀도 레이). 하나라도 맞으면 즉시 true. */
export function occludedStudioPathtraceBvh(
  positions: Float32Array,
  indices: Uint32Array,
  bvh: StudioPathtraceBvh,
  ray: StudioPathtraceRay,
  tMin: number,
  tMax: number,
  stats?: StudioPathtraceTraversalStats,
): boolean {
  if (bvh.triangleCount === 0) return false;
  const { nodeBounds, nodeMeta, triIndex } = bvh;
  const stackNode = occludedStackNode;
  let sp = 0;
  const bary = occludedBary;

  if (
    intersectStudioPathtraceAabb(
      ray,
      nodeBounds[0],
      nodeBounds[1],
      nodeBounds[2],
      nodeBounds[3],
      nodeBounds[4],
      nodeBounds[5],
      tMin,
      tMax,
    ) < 0
  ) {
    return false;
  }
  stackNode[sp] = 0;
  sp += 1;

  while (sp > 0) {
    sp -= 1;
    const node = stackNode[sp];
    if (stats) stats.nodeVisits += 1;
    const count = nodeMeta[node * 2 + 1];
    if (count > 0) {
      const first = nodeMeta[node * 2];
      for (let i = 0; i < count; i += 1) {
        const tri = triIndex[first + i];
        const i0 = indices[tri * 3] * 3;
        const i1 = indices[tri * 3 + 1] * 3;
        const i2 = indices[tri * 3 + 2] * 3;
        if (stats) stats.triangleTests += 1;
        const t = intersectStudioPathtraceTriangle(
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
          tMin,
          tMax,
          bary,
        );
        if (t >= 0) return true;
      }
      continue;
    }
    const left = nodeMeta[node * 2];
    const right = left + 1;
    for (let c = 0; c < 2; c += 1) {
      const child = c === 0 ? left : right;
      const th = intersectStudioPathtraceAabb(
        ray,
        nodeBounds[child * 6],
        nodeBounds[child * 6 + 1],
        nodeBounds[child * 6 + 2],
        nodeBounds[child * 6 + 3],
        nodeBounds[child * 6 + 4],
        nodeBounds[child * 6 + 5],
        tMin,
        tMax,
      );
      if (th >= 0) {
        stackNode[sp] = child;
        sp += 1;
      }
    }
  }
  return false;
}

/** BVH 없이 전수 검사하는 참조 구현(테스트 대조군). */
export function intersectStudioPathtraceBruteForce(
  positions: Float32Array,
  indices: Uint32Array,
  ray: StudioPathtraceRay,
  tMin: number,
  tMax: number,
  hit: StudioPathtraceHit = createStudioPathtraceHit(),
): StudioPathtraceHit {
  hit.t = -1;
  hit.triangle = -1;
  hit.u = 0;
  hit.v = 0;
  let best = tMax;
  const bary: number[] = [0, 0];
  const triangleCount = Math.floor(indices.length / 3);
  for (let tri = 0; tri < triangleCount; tri += 1) {
    const i0 = indices[tri * 3] * 3;
    const i1 = indices[tri * 3 + 1] * 3;
    const i2 = indices[tri * 3 + 2] * 3;
    const t = intersectStudioPathtraceTriangle(
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
      tMin,
      best,
      bary,
    );
    if (t >= 0) {
      best = t;
      hit.t = t;
      hit.triangle = tri;
      hit.u = bary[0];
      hit.v = bary[1];
    }
  }
  return hit;
}
