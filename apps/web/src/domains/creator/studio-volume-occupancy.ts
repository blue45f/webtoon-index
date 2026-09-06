/**
 * Studio Volume — 빈 공간 스킵(coarse occupancy grid)
 *
 * 연기는 대개 바운딩 박스의 10~30% 만 채운다. 나머지를 스텝별로 삼선형 샘플링하는 건 순수 낭비다.
 * B×B×B 복셀을 한 블록으로 묶어 **블록별 최대 밀도**를 굽고, 레이가 지나가는 블록을 3D-DDA
 * (Amanatides & Woo)로 훑어 "밀도가 있을 수 있는 구간"만 돌려준다.
 *
 * ── 보수성(conservativeness) 증명 ────────────────────────────────────────
 * 스킵이 이미지를 바꾸지 않으려면 "빈 블록 안의 어떤 점을 삼선형 샘플링해도 정확히 0" 이어야 한다.
 * 블록 b 의 오브젝트 공간 구간에 있는 점의 연속 격자 좌표는
 *      g ∈ [b·B - 0.5, (b+1)·B - 0.5)
 * 이고 삼선형 지지대는 floor(g) 와 floor(g)+1 이므로 복셀 인덱스 범위는
 *      [b·B - 1, (b+1)·B]
 * 이다. 따라서 블록 최대값을 **1 복셀 에이프런(apron)** 까지 포함해 굽는다. clamp-to-edge 경계
 * 처리로 범위 밖 인덱스는 이 집합 안으로 되돌아오므로 지지대가 새지 않는다.
 *
 * threshold 는 기본 0 이다(밀도가 정확히 0 인 블록만 빈 것으로 간주). 0 보다 크게 잡으면 더 많이
 * 스킵되지만 그만큼 **편향(bias)** 이 생긴다 — 계약을 아는 호출부만 올릴 것.
 */

import type { StudioVolumePrepared } from "./studio-volume-grid";

export interface StudioVolumeOccupancy {
  /** 블록 한 변의 복셀 수. */
  readonly blockSize: number;
  /** 블록 격자 크기 (bx, by, bz) = ceil(resolution / blockSize). */
  readonly dims: readonly [number, number, number];
  /** 블록별 최대 밀도(에이프런 포함). index = bx + dims[0]*(by + dims[1]*bz). */
  readonly maxDensity: Float32Array;
  /** 이 값 이하인 블록은 "빈 블록". */
  readonly threshold: number;
  /** 오브젝트 공간 블록 한 변 크기 = blockSize * cellSize. */
  readonly blockExtent: readonly [number, number, number];
  readonly occupiedBlocks: number;
  readonly totalBlocks: number;
}

/** 스킵 구간(오브젝트 공간 레이 파라미터, 월드 거리 단위). */
export interface StudioVolumeInterval {
  readonly tStart: number;
  readonly tEnd: number;
}

export const STUDIO_VOLUME_DEFAULT_BLOCK_SIZE = 8;

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * 블록별 최대 밀도를 굽는다. 에이프런 1 복셀 포함 — 위 보수성 증명 참고.
 * 퇴화 볼륨이면 블록 0개짜리 구조체를 돌려준다(호출부는 항상 "빈 볼륨"으로 처리된다).
 */
export function buildStudioVolumeOccupancy(
  prepared: StudioVolumePrepared,
  blockSize: number = STUDIO_VOLUME_DEFAULT_BLOCK_SIZE,
  threshold = 0
): StudioVolumeOccupancy {
  const size = Math.max(1, Math.floor(blockSize));
  if (prepared.degenerate) {
    return {
      blockSize: size,
      dims: [0, 0, 0],
      maxDensity: new Float32Array(0),
      threshold,
      blockExtent: [0, 0, 0],
      occupiedBlocks: 0,
      totalBlocks: 0,
    };
  }

  const [nx, ny, nz] = prepared.resolution;
  const bx = Math.ceil(nx / size);
  const by = Math.ceil(ny / size);
  const bz = Math.ceil(nz / size);
  const total = bx * by * bz;
  const maxDensity = new Float32Array(total);
  const density = prepared.density;

  let occupied = 0;
  for (let bk = 0; bk < bz; bk += 1) {
    const k0 = clampInt(bk * size - 1, 0, nz - 1);
    const k1 = clampInt((bk + 1) * size, 0, nz - 1);
    for (let bj = 0; bj < by; bj += 1) {
      const j0 = clampInt(bj * size - 1, 0, ny - 1);
      const j1 = clampInt((bj + 1) * size, 0, ny - 1);
      for (let bi = 0; bi < bx; bi += 1) {
        const i0 = clampInt(bi * size - 1, 0, nx - 1);
        const i1 = clampInt((bi + 1) * size, 0, nx - 1);
        let max = 0;
        for (let k = k0; k <= k1; k += 1) {
          const slice = nx * ny * k;
          for (let j = j0; j <= j1; j += 1) {
            const row = slice + nx * j;
            for (let i = i0; i <= i1; i += 1) {
              const v = density[row + i];
              if (v > max) max = v;
            }
          }
        }
        maxDensity[bi + bx * (bj + by * bk)] = max;
        if (max > threshold) occupied += 1;
      }
    }
  }

  return {
    blockSize: size,
    dims: [bx, by, bz],
    maxDensity,
    threshold,
    blockExtent: [
      size * prepared.cellSize[0],
      size * prepared.cellSize[1],
      size * prepared.cellSize[2],
    ],
    occupiedBlocks: occupied,
    totalBlocks: total,
  };
}

function blockOccupied(occupancy: StudioVolumeOccupancy, bi: number, bj: number, bk: number): boolean {
  const [bx, by] = occupancy.dims;
  return occupancy.maxDensity[bi + bx * (bj + by * bk)] > occupancy.threshold;
}

/**
 * 3D-DDA 로 [tEnter, tExit] 구간에서 **점유 블록이 연속된 구간**만 병합해 반환한다.
 * 오브젝트 공간 레이(비정규화 방향)를 받고, 반환 t 는 월드 거리 단위다.
 *
 * 블록 격자는 boundsMin 을 원점으로 blockExtent 간격으로 깔린다. resolution 이 blockSize 의
 * 배수가 아니면 마지막 블록이 AABB 밖까지 뻗지만, 순회는 tExit 에서 잘리므로 무해하다.
 */
export function studioVolumeOccupiedIntervals(
  prepared: StudioVolumePrepared,
  occupancy: StudioVolumeOccupancy,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  tEnter: number,
  tExit: number
): StudioVolumeInterval[] {
  const intervals: StudioVolumeInterval[] = [];
  if (occupancy.totalBlocks === 0 || occupancy.occupiedBlocks === 0) return intervals;
  if (!(tExit > tEnter)) return intervals;

  const { boundsMin } = prepared;
  const dims = occupancy.dims;
  const extent = occupancy.blockExtent;

  const origin = [ox, oy, oz];
  const dir = [dx, dy, dz];
  const block = [0, 0, 0];
  const step = [0, 0, 0];
  const tMaxAxis = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const tDelta = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];

  // 진입점을 살짝 안쪽으로 밀어 경계 위에서 블록 인덱스가 튀는 것을 막는다.
  const nudged = tEnter + (tExit - tEnter) * 1e-6;
  for (let axis = 0; axis < 3; axis += 1) {
    const p = origin[axis] + nudged * dir[axis];
    const local = (p - boundsMin[axis]) / extent[axis];
    block[axis] = clampInt(Math.floor(local), 0, dims[axis] - 1);
    const d = dir[axis];
    if (d === 0 || !Number.isFinite(d)) {
      step[axis] = 0;
      continue;
    }
    step[axis] = d > 0 ? 1 : -1;
    const boundaryIndex = d > 0 ? block[axis] + 1 : block[axis];
    const boundary = boundsMin[axis] + boundaryIndex * extent[axis];
    tMaxAxis[axis] = tEnter + (boundary - (origin[axis] + tEnter * d)) / d;
    tDelta[axis] = Math.abs(extent[axis] / d);
  }

  let tCurrent = tEnter;
  let runStart = Number.NaN;
  let runEnd = Number.NaN;
  const maxIterations = 4 * (dims[0] + dims[1] + dims[2]) + 8;

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let axis = 0;
    if (tMaxAxis[1] < tMaxAxis[axis]) axis = 1;
    if (tMaxAxis[2] < tMaxAxis[axis]) axis = 2;
    const tNext = Math.min(tMaxAxis[axis], tExit);

    if (tNext > tCurrent && blockOccupied(occupancy, block[0], block[1], block[2])) {
      if (Number.isNaN(runStart)) {
        runStart = tCurrent;
        runEnd = tNext;
      } else {
        runEnd = tNext;
      }
    } else if (!Number.isNaN(runStart)) {
      intervals.push({ tStart: runStart, tEnd: runEnd });
      runStart = Number.NaN;
    }

    if (tNext >= tExit) break;
    tCurrent = tNext;
    block[axis] += step[axis];
    if (block[axis] < 0 || block[axis] >= dims[axis]) break;
    tMaxAxis[axis] += tDelta[axis];
  }

  if (!Number.isNaN(runStart)) intervals.push({ tStart: runStart, tEnd: runEnd });
  return intervals;
}

/**
 * 스텝 격자 인덱스 범위로 변환한다. 스텝 k 는 t ∈ [tEnter + k·dt, tEnter + (k+1)·dt) 를 담당하므로
 * 구간과 겹치는 k 는 floor((tStart-tEnter)/dt) .. floor((tEnd-tEnter)/dt) 이다. 부동소수 여유로
 * 양쪽에 1 을 더 넣는다(샘플을 더 평가하는 것은 항상 안전하고, 빠뜨리는 것만 위험하다).
 *
 * 반환은 겹치지 않고 오름차순인 [lo, hi] 쌍의 평탄 배열이다.
 */
export function studioVolumeStepRanges(
  intervals: readonly StudioVolumeInterval[],
  tEnter: number,
  stepSize: number,
  stepCount: number
): number[] {
  const ranges: number[] = [];
  if (stepCount <= 0 || !(stepSize > 0)) return ranges;
  let cursor = 0;
  for (let i = 0; i < intervals.length; i += 1) {
    const lo = Math.max(cursor, Math.floor((intervals[i].tStart - tEnter) / stepSize) - 1);
    const hi = Math.min(stepCount - 1, Math.floor((intervals[i].tEnd - tEnter) / stepSize) + 1);
    if (hi < lo) continue;
    ranges.push(lo, hi);
    cursor = hi + 1;
    if (cursor >= stepCount) break;
  }
  return ranges;
}
