/**
 * Studio Lift 3D — 실루엣의 좌우 대칭 축을 찾고, 그 축으로 깊이를 고르게 펴는 단계.
 *
 * 캐릭터 원화는 대개 좌우가 거의 대칭이지만 정확히 대칭으로 그려지지는 않는다. 거리장은 그
 * 미세한 어긋남을 그대로 두께로 옮기므로, 정면을 보는 캐릭터인데도 한쪽 뺨이나 어깨만 더
 * 두꺼워지는 결과가 나온다. 축을 찾아 깊이를 평균 내면 그 편향이 사라진다.
 *
 * 축 자체도 쓸모가 있다. 대칭 점수가 낮다는 것은 "정면이 아니거나 여러 대상이 한 장에 있다"는
 * 신호라, 대칭 보정을 자동으로 켜도 되는지 판단하는 근거가 된다.
 */

import { clampStudioLift3dUnit } from "./studio-lift3d-contract";

import type { StudioLift3dMask } from "./studio-lift3d-mask";

/** 축 후보는 반 칸 간격으로 둔다 — 그래야 거울상 좌표가 정수 격자에 정확히 떨어진다. */
const AXIS_STEP = 0.5;
/** 중심에서 실루엣 폭의 이 비율만큼만 탐색한다. 대칭 축이 그 밖에 있을 일은 없다. */
const AXIS_SEARCH_SPAN_RATIO = 0.15;
/** 이 점수 아래면 좌우대칭으로 보기 어렵다(옆모습, 여러 대상, 비대칭 포즈). */
export const STUDIO_LIFT3D_SYMMETRY_CONFIDENT_SCORE = 0.82;

export interface StudioLift3dSymmetry {
  /** 격자 열 좌표. 반 칸 단위라 정수 또는 x.5 다. */
  readonly axisX: number;
  /** 축으로 뒤집었을 때 실루엣이 겹치는 정도(IoU). 1 이면 완전 대칭. */
  readonly score: number;
  /** 점수가 기준선을 넘어 대칭 보정을 믿고 켤 만한지. */
  readonly confident: boolean;
}

/** 마스크의 x 방향 무게중심. 축 탐색의 출발점이다. */
function maskCentroidX(mask: StudioLift3dMask): number | null {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if (mask.cells[y * mask.width + x] === 1) {
        sum += x;
        count += 1;
      }
    }
  }
  return count === 0 ? null : sum / count;
}

/** 축 하나에 대한 IoU. 거울상이 격자를 벗어나면 그 셀은 합집합에만 들어간다. */
function symmetryScoreAt(mask: StudioLift3dMask, axisX: number): number {
  const { cells, width, height } = mask;
  let intersection = 0;
  let union = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const here = cells[row + x] === 1;
      const mirrorX = Math.round(2 * axisX - x);
      const inGrid = mirrorX >= 0 && mirrorX < width;
      const mirrored = inGrid && cells[row + mirrorX] === 1;
      if (here && mirrored) intersection += 1;
      if (here || mirrored) union += 1;
      // 격자를 벗어난 거울상 셀은 이 루프가 **절대 방문하지 않는다**. 합집합에만 있는 셀이니
      // 여기서 따로 더해야 한다. 빠뜨리면 어긋남 하나를 두 번이 아니라 한 번만 세어 점수가
      // 부풀고, 실루엣이 가장자리에 붙은 비대칭 원화에 대칭 보정이 걸린다.
      if (here && !inGrid) union += 1;
    }
  }
  return union === 0 ? 0 : intersection / union;
}

/**
 * 실루엣을 가장 잘 반으로 접는 세로축을 찾는다.
 *
 * 무게중심 주변만 반 칸 간격으로 훑는다. 전체 폭을 훑어도 결과는 같지만, 대칭 축이 실루엣
 * 중심에서 폭의 15% 밖으로 벗어나는 경우는 없어서 그만큼은 낭비다.
 */
export function findStudioLift3dSymmetryAxis(
  mask: StudioLift3dMask,
): StudioLift3dSymmetry | null {
  if (mask.bounds === null) return null;
  const centroid = maskCentroidX(mask);
  if (centroid === null) return null;

  const span = Math.max(1, mask.bounds.maxX - mask.bounds.minX);
  const reach = Math.max(AXIS_STEP, span * AXIS_SEARCH_SPAN_RATIO);
  const first = Math.max(0, Math.round((centroid - reach) / AXIS_STEP) * AXIS_STEP);
  const last = Math.min(mask.width - 1, centroid + reach);

  let bestAxis = centroid;
  let bestScore = -1;
  for (let axis = first; axis <= last; axis += AXIS_STEP) {
    const score = symmetryScoreAt(mask, axis);
    if (score > bestScore) {
      bestScore = score;
      bestAxis = axis;
    }
  }
  const score = clampStudioLift3dUnit(bestScore);
  return {
    axisX: bestAxis,
    score,
    confident: score >= STUDIO_LIFT3D_SYMMETRY_CONFIDENT_SCORE,
  };
}

/**
 * 축을 기준으로 좌우 높이를 섞는다. `strength` 1 이면 완전 평균, 0 이면 원본 그대로.
 *
 * 거울상이 실루엣 밖이면 섞지 않는다 — 한쪽에만 있는 부위(들고 있는 소품, 흘러내린 머리)를
 * 반대쪽 두께로 눌러버리지 않기 위해서다.
 */
export function symmetrizeStudioLift3dHeights(
  heights: Float64Array,
  mask: StudioLift3dMask,
  axisX: number,
  strength: number,
): Float64Array {
  const mix = clampStudioLift3dUnit(strength);
  if (mix <= 0) return heights;
  const { cells, width, height } = mask;
  const out = new Float64Array(heights);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (cells[row + x] === 0) continue;
      const mirrorX = Math.round(2 * axisX - x);
      if (mirrorX < 0 || mirrorX >= width || cells[row + mirrorX] === 0) continue;
      const average = (heights[row + x]! + heights[row + mirrorX]!) / 2;
      out[row + x] = heights[row + x]! * (1 - mix) + average * mix;
    }
  }
  return out;
}
