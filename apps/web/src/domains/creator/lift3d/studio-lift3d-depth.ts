/**
 * Studio Lift 3D — 실루엣과 명암에서 깊이장을 세우는 단계.
 *
 * 두 가지 단서를 쓴다.
 * 1) 실루엣 거리장: 윤곽에서 멀수록 두껍다. 팔·머리카락처럼 가는 부위는 얇게, 몸통은 두껍게
 *    부풀어 캐릭터 리프트의 기본 볼륨이 된다(Teddy 계열 inflation).
 * 2) 명암(relief): 밝은 면이 앞으로 나온다는 표준 shape-from-shading 가정. 배경 원화의
 *    창틀·벽돌·계단 같은 요철을 부조로 살릴 때 쓴다.
 *
 * 순수 함수만 두고, 결과는 항상 0..1 로 정규화된 높이장이다. 실제 두께(scene unit)는
 * 메시 빌더가 곱한다.
 */

import { clampStudioLift3dUnit as clamp01 } from "./studio-lift3d-contract";

import type { StudioLift3dDepthProfile } from "./studio-lift3d-contract";
import type { StudioLift3dMask, StudioLift3dSampleGrid } from "./studio-lift3d-mask";

/** 오르토고날 3 / 대각 4 가중치의 정수 chamfer. 두 번의 스캔으로 끝난다. */
const CHAMFER_ORTHOGONAL = 3;
const CHAMFER_DIAGONAL = 4;
const SLAB_BEVEL = 0.18;

export interface StudioLift3dDepthField {
  readonly width: number;
  readonly height: number;
  /** 0..1. 실루엣 경계에서 0(=inflate 봉합선), 가장 두꺼운 곳에서 1. */
  readonly heights: Float64Array;
  /** 픽셀 단위 최대 실루엣 내접 거리. 얇은 피사체 판정에 쓴다. */
  readonly maxDistance: number;
}

export interface StudioLift3dDepthOptions {
  readonly profile?: StudioLift3dDepthProfile;
  /** relief 프로파일의 명암 대비(감마). 1 = 선형. */
  readonly reliefGamma?: number;
  /** true 면 어두운 면이 앞으로 나온다(역광/실루엣 배경). */
  readonly invertRelief?: boolean;
  /** relief 높이를 실루엣 거리로 얼마나 깎을지(0..1). 잘라낸 배경 조각을 봉합할 때 쓴다. */
  readonly edgeTaper?: number;
  /** 라플라시안 평활 반복 횟수. chamfer 특유의 능선을 지운다. */
  readonly smoothing?: number;
}

/**
 * 마스크 내부 각 셀의 윤곽까지 거리(픽셀 근사)를 구한다.
 * 격자 밖은 배경으로 본다 — 화면에 잘린 피사체도 그 변에서 닫히게 하려는 것이다.
 */
export function studioLift3dDistanceField(
  cells: Uint8Array,
  width: number,
  height: number,
): Float64Array {
  const size = width * height;
  const far = (width + height) * CHAMFER_DIAGONAL;
  const distance = new Int32Array(size);
  for (let index = 0; index < size; index += 1) {
    distance[index] = cells[index] === 1 ? far : 0;
  }
  const at = (x: number, y: number): number => (
    x < 0 || y < 0 || x >= width || y >= height ? 0 : distance[y * width + x]!
  );

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      let best = distance[index]!;
      best = Math.min(best, at(x - 1, y - 1) + CHAMFER_DIAGONAL);
      best = Math.min(best, at(x, y - 1) + CHAMFER_ORTHOGONAL);
      best = Math.min(best, at(x + 1, y - 1) + CHAMFER_DIAGONAL);
      best = Math.min(best, at(x - 1, y) + CHAMFER_ORTHOGONAL);
      distance[index] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x;
      if (distance[index] === 0) continue;
      let best = distance[index]!;
      best = Math.min(best, at(x + 1, y + 1) + CHAMFER_DIAGONAL);
      best = Math.min(best, at(x, y + 1) + CHAMFER_ORTHOGONAL);
      best = Math.min(best, at(x - 1, y + 1) + CHAMFER_DIAGONAL);
      best = Math.min(best, at(x + 1, y) + CHAMFER_ORTHOGONAL);
      distance[index] = best;
    }
  }

  const pixels = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    pixels[index] = distance[index]! / CHAMFER_ORTHOGONAL;
  }
  return pixels;
}

/**
 * 마스크 내부의 휘도를 0..1 로 정규화한다. 정규화 범위를 피사체 안쪽으로 제한해야
 * 배경의 흰 여백이 대비를 다 잡아먹지 않는다.
 */
export function studioLift3dShadingField(
  grid: StudioLift3dSampleGrid,
  cells: Uint8Array,
): Float64Array {
  const size = grid.width * grid.height;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < size; index += 1) {
    if (cells[index] === 0) continue;
    const value = grid.luminance[index]!;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const shading = new Float64Array(size);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
    for (let index = 0; index < size; index += 1) {
      shading[index] = cells[index] === 1 ? 0.5 : 0;
    }
    return shading;
  }
  const inverse = 1 / (max - min);
  for (let index = 0; index < size; index += 1) {
    shading[index] = cells[index] === 1 ? clamp01((grid.luminance[index]! - min) * inverse) : 0;
  }
  return shading;
}

/**
 * 마스크 내부만 4-이웃 평균으로 평활한다. 윤곽에 맞닿은 셀은 고정해 봉합선 높이 0 을 지킨다.
 */
export function smoothStudioLift3dHeights(
  heights: Float64Array,
  cells: Uint8Array,
  width: number,
  height: number,
  iterations: number,
  pinRim: boolean,
): Float64Array {
  if (iterations <= 0) return heights;
  // 버퍼 두 개를 번갈아 쓴다. 패스마다 새로 복사하면 256 격자 × 12회에서 512KB 배열을
  // 열두 번 할당하고, 슬라이더를 끌 때마다 그 비용을 다시 낸다.
  let current: Float64Array = heights;
  let scratch: Float64Array = new Float64Array(heights.length);
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = scratch;
    next.set(current);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        if (cells[index] === 0) continue;
        let sum = 0;
        let count = 0;
        let rim = x === 0 || y === 0 || x + 1 === width || y + 1 === height;
        if (x > 0) {
          if (cells[index - 1] === 1) { sum += current[index - 1]!; count += 1; } else rim = true;
        }
        if (x + 1 < width) {
          if (cells[index + 1] === 1) { sum += current[index + 1]!; count += 1; } else rim = true;
        }
        if (y > 0) {
          if (cells[index - width] === 1) { sum += current[index - width]!; count += 1; } else rim = true;
        }
        if (y + 1 < height) {
          if (cells[index + width] === 1) { sum += current[index + width]!; count += 1; } else rim = true;
        }
        if (pinRim && rim) continue;
        if (count === 0) continue;
        next[index] = (current[index]! + sum / count) / 2;
      }
    }
    scratch = current === heights ? new Float64Array(heights.length) : current;
    current = next;
  }
  return current;
}

function applyProfile(
  profile: StudioLift3dDepthProfile,
  normalizedDistance: number,
): number {
  const t = clamp01(normalizedDistance);
  switch (profile) {
    case "round":
      // 원형 단면. 윤곽에서 접선이 수직이라 옆에서 봐도 납작해 보이지 않는다.
      return Math.sqrt(Math.max(0, 2 * t - t * t));
    case "soft":
      return t * t * (3 - 2 * t);
    case "slab":
      return Math.min(1, t / SLAB_BEVEL);
    case "relief":
      return t;
    default:
      return t;
  }
}

/**
 * 실루엣(과 선택적으로 명암)에서 0..1 높이장을 만든다.
 *
 * `relief` 프로파일은 거리장을 두께가 아니라 테두리 테이퍼로만 쓰고, 높이는 명암이 정한다.
 * 나머지 프로파일은 명암을 무시하고 거리장만 쓴다 — 캐릭터 원화의 밝기는 조명이지 두께가 아니다.
 */
export function buildStudioLift3dDepthField(
  mask: StudioLift3dMask,
  grid: StudioLift3dSampleGrid,
  options: StudioLift3dDepthOptions = {},
): StudioLift3dDepthField {
  const { cells, width, height } = mask;
  const size = width * height;
  const profile = options.profile ?? "round";
  const distance = studioLift3dDistanceField(cells, width, height);
  let maxDistance = 0;
  for (let index = 0; index < size; index += 1) {
    if (distance[index]! > maxDistance) maxDistance = distance[index]!;
  }
  // 윤곽에 맞닿은 셀의 거리는 1 이다. 그 1 을 0 으로 옮겨야 앞뒤 껍질이 정확히 만난다.
  const span = Math.max(maxDistance - 1, 1e-6);
  const heights = new Float64Array(size);

  if (profile === "relief") {
    const shading = studioLift3dShadingField(grid, cells);
    const gamma = Math.max(0.2, Math.min(4, options.reliefGamma ?? 1));
    const taper = clamp01(options.edgeTaper ?? 0);
    for (let index = 0; index < size; index += 1) {
      if (cells[index] === 0) continue;
      const lit = options.invertRelief === true ? 1 - shading[index]! : shading[index]!;
      const base = Math.pow(clamp01(lit), gamma);
      const edge = clamp01((distance[index]! - 1) / span);
      heights[index] = base * (1 - taper) + base * taper * edge;
    }
  } else {
    for (let index = 0; index < size; index += 1) {
      if (cells[index] === 0) continue;
      heights[index] = applyProfile(profile, (distance[index]! - 1) / span);
    }
  }

  const smoothed = smoothStudioLift3dHeights(
    heights,
    cells,
    width,
    height,
    Math.max(0, Math.min(24, Math.round(options.smoothing ?? 0))),
    profile !== "relief",
  );

  return { width, height, heights: smoothed, maxDistance };
}

export interface StudioLift3dDepthBand {
  readonly index: number;
  /** 이 밴드에 속한 셀만 1. 마스크와 같은 크기·인덱스. */
  readonly cells: Uint8Array;
  /** 0..1 밴드 대표 깊이(구간 중앙). 카드가 놓일 z 를 정한다. */
  readonly center: number;
  readonly cellCount: number;
}

export const STUDIO_LIFT3D_MAX_DEPTH_BANDS = 24;

/** 밴드 수를 허용 범위로 조인다. 카드 두께 계산이 같은 값을 써야 층이 겹치지 않는다. */
export function clampStudioLift3dBandCount(bandCount: number): number {
  if (!Number.isFinite(bandCount)) return 1;
  return Math.max(1, Math.min(STUDIO_LIFT3D_MAX_DEPTH_BANDS, Math.round(bandCount)));
}

/**
 * 셀마다 어느 깊이 밴드에 속하는지. 마스크 밖은 −1.
 *
 * 밴드 소속의 **단일 출처**다. 셀 집합(`buildStudioLift3dDepthBands`)과 면 배정(메시 빌더)이
 * 각자 구간을 계산하면 둘이 어긋날 수 있어, 둘 다 이 배열을 받아 쓴다.
 */
export function studioLift3dBandBuckets(
  mask: StudioLift3dMask,
  depth: StudioLift3dDepthField,
  bandCount: number,
): Int32Array {
  const bands = clampStudioLift3dBandCount(bandCount);
  const size = mask.width * mask.height;
  const buckets = new Int32Array(size).fill(-1);
  for (let index = 0; index < size; index += 1) {
    if (mask.cells[index] === 0) continue;
    const height = clamp01(depth.heights[index] ?? 0);
    // 1 은 마지막 밴드에 속한다. floor 만 쓰면 밴드가 하나 더 생긴다.
    buckets[index] = Math.min(bands - 1, Math.floor(height * bands));
  }
  return buckets;
}

/**
 * 깊이장을 같은 폭의 구간으로 잘라 밴드별 셀 집합을 만든다.
 *
 * 시차(parallax) 레이어의 재료다. 연속된 부조를 몇 장의 평평한 카드로 바꾸면 카메라가 움직일 때
 * 층이 서로 다른 속도로 흘러, 웹툰 배경이 기대하는 깊이감이 훨씬 또렷하게 읽힌다.
 *
 * **밴드는 겹치지 않는다.** 한때는 각 밴드를 한 칸씩 부풀려 경계 사각형이 양쪽 카드에 모두
 * 들어가게 했는데, 깊이가 셀 단위로 번갈아 나오는 원화에서는 그 한 칸이 밴드를 마스크 전체로
 * 넓혔다(측정: 체커보드 100%, `(x+3y)%12` 74.5%). 배경은 껍질마다 불투명 재질에 원본 전체
 * 텍스처를 쓰므로, 그렇게 커진 앞 카드가 뒤 카드를 통째로 가려 시차가 사라졌다. 지금은 경계
 * 사각형을 **면 단위로 한 밴드에만** 준다(메시 빌더의 면 배정 참고) — 구멍도 없고 겹침도 없다.
 *
 * 비어 있는 밴드는 버린다 — 하늘만 있는 원화에서 중간 밴드가 통째로 비는 일은 흔하고,
 * 빈 카드는 면 없는 지오메트리로만 남는다.
 */
export function buildStudioLift3dDepthBands(
  mask: StudioLift3dMask,
  depth: StudioLift3dDepthField,
  bandCount: number,
): readonly StudioLift3dDepthBand[] {
  const bands = clampStudioLift3dBandCount(bandCount);
  const buckets = studioLift3dBandBuckets(mask, depth, bands);
  const size = mask.width * mask.height;
  const cellSets: Uint8Array[] = Array.from({ length: bands }, () => new Uint8Array(size));
  const counts = new Int32Array(bands);

  for (let index = 0; index < size; index += 1) {
    const bucket = buckets[index]!;
    if (bucket < 0) continue;
    cellSets[bucket]![index] = 1;
    counts[bucket] += 1;
  }

  const out: StudioLift3dDepthBand[] = [];
  for (let index = 0; index < bands; index += 1) {
    if (counts[index] === 0) continue;
    out.push({
      index,
      cells: cellSets[index]!,
      center: (index + 0.5) / bands,
      cellCount: counts[index]!,
    });
  }
  return Object.freeze(out);
}

