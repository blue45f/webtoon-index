/**
 * Studio Lift 3D — 원화에서 피사체 실루엣 마스크를 뽑아내는 단계.
 *
 * 리프트 품질은 거의 전부 이 마스크가 결정한다. 알파가 있는 PNG 는 알파를,
 * 알파가 없는 스캔/JPEG 은 테두리에서 흘려보낸 배경 키를 쓰고, 배경 원화처럼
 * 이미지 전체가 피사체인 경우는 `full` 로 마스크 단계를 통째로 건너뛴다.
 *
 * 모든 연산은 정수 격자 위의 결정론적 반복이며 DOM/Canvas 를 참조하지 않는다.
 */

import {
  STUDIO_LIFT3D_LIMITS,
  clampStudioLift3dUnit as clamp01,
  studioLift3dWarning,
  type StudioLift3dMaskMode,
  type StudioLift3dResolvedMaskMode,
  type StudioLift3dSourceImage,
  type StudioLift3dWarning,
} from "./studio-lift3d-contract";

/** 작업 격자로 내려받은 원화. 색은 0..1, 알파는 0..1 로 정규화되어 있다. */
export interface StudioLift3dSampleGrid {
  readonly width: number;
  readonly height: number;
  /** RGB, 셀당 3성분. 알파 가중 평균이라 투명 영역의 색 번짐(halo)이 없다. */
  readonly color: Float64Array;
  readonly alpha: Float64Array;
  /** Rec.709 상대 휘도. 부조(relief) 깊이 추정과 배경 키 판정이 공유한다. */
  readonly luminance: Float64Array;
}

export interface StudioLift3dMaskBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface StudioLift3dMask {
  readonly width: number;
  readonly height: number;
  /** 1 = 피사체, 0 = 배경. */
  readonly cells: Uint8Array;
  readonly bounds: StudioLift3dMaskBounds | null;
  /** 피사체 셀 / 전체 셀. */
  readonly coverage: number;
  readonly mode: StudioLift3dResolvedMaskMode;
  readonly warnings: readonly StudioLift3dWarning[];
}

export interface StudioLift3dMaskOptions {
  readonly mode?: StudioLift3dMaskMode;
  /** 0..1. 이 알파 미만은 배경으로 본다. */
  readonly alphaThreshold?: number;
  /** 0..1. 배경 키 색과의 허용 색차(RGB 유클리드 거리 / √3). */
  readonly keyTolerance?: number;
  /** 3×3 열림/닫힘으로 점 노이즈와 바늘구멍을 정리한다. */
  readonly despeckle?: boolean;
  /** 가장 큰 연결 성분만 남긴다(캐릭터 한 명만 들어올릴 때). */
  readonly keepLargestPart?: boolean;
}

const DEFAULT_ALPHA_THRESHOLD = 0.34;
const DEFAULT_KEY_TOLERANCE = 0.14;
/** 이 비율 이상이 반투명/투명이면 알파 채널이 실제로 쓰이고 있다고 본다. */
const ALPHA_PRESENCE_RATIO = 0.005;
/** 버려진 조각이 이 비율을 넘으면 사용자에게 알린다. */
const DROPPED_PART_NOTICE_RATIO = 0.04;

/**
 * 원본을 작업 격자로 내려받는다(박스 필터 평균).
 *
 * 색은 알파로 가중 평균한다. 투명 픽셀의 (보통 검은) RGB 가 섞이면 실루엣 가장자리에
 * 어두운 띠가 남고, 그 띠가 그대로 텍스처와 깊이장에 새겨지기 때문이다.
 */
export function resampleStudioLift3dImage(
  source: StudioLift3dSourceImage,
  resolution: number,
): StudioLift3dSampleGrid {
  const longest = Math.max(source.width, source.height);
  const scale = Math.min(1, resolution / longest);
  const width = Math.max(2, Math.round(source.width * scale));
  const height = Math.max(2, Math.round(source.height * scale));
  const cells = width * height;
  const color = new Float64Array(cells * 3);
  const alpha = new Float64Array(cells);
  const luminance = new Float64Array(cells);
  const { pixels } = source;

  for (let gy = 0; gy < height; gy += 1) {
    const y0 = Math.floor((gy * source.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * source.height) / height));
    for (let gx = 0; gx < width; gx += 1) {
      const x0 = Math.floor((gx * source.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * source.width) / width));
      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let samples = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        const rowOffset = sy * source.width;
        for (let sx = x0; sx < x1; sx += 1) {
          const p = (rowOffset + sx) * 4;
          const a = pixels[p + 3]! / 255;
          sumA += a;
          sumR += (pixels[p]! / 255) * a;
          sumG += (pixels[p + 1]! / 255) * a;
          sumB += (pixels[p + 2]! / 255) * a;
          samples += 1;
        }
      }
      const index = gy * width + gx;
      const meanAlpha = samples === 0 ? 0 : sumA / samples;
      // 완전 투명한 셀은 색을 정의할 수 없다. 중립 회색으로 두면 relief 깊이가 튀지 않는다.
      const inverse = sumA > 1e-9 ? 1 / sumA : 0;
      const r = inverse === 0 ? 0.5 : sumR * inverse;
      const g = inverse === 0 ? 0.5 : sumG * inverse;
      const b = inverse === 0 ? 0.5 : sumB * inverse;
      color[index * 3] = r;
      color[index * 3 + 1] = g;
      color[index * 3 + 2] = b;
      alpha[index] = meanAlpha;
      luminance[index] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
  }

  return { width, height, color, alpha, luminance };
}

/** 알파 채널이 실제로 실루엣을 담고 있는지(= 알파 마스크를 신뢰할 수 있는지) 판단한다. */
export function studioLift3dHasUsableAlpha(grid: StudioLift3dSampleGrid): boolean {
  let transparent = 0;
  for (let i = 0; i < grid.alpha.length; i += 1) {
    if (grid.alpha[i]! < 0.96) transparent += 1;
  }
  return transparent / grid.alpha.length >= ALPHA_PRESENCE_RATIO;
}

function forEachNeighbor4(
  index: number,
  width: number,
  height: number,
  visit: (neighborIndex: number) => void,
): void {
  const x = index % width;
  const y = (index - x) / width;
  if (x > 0) visit(index - 1);
  if (x + 1 < width) visit(index + 1);
  if (y > 0) visit(index - width);
  if (y + 1 < height) visit(index + width);
}

/** 테두리에서 시작해 배경 후보 셀만 타고 번지는 4-연결 플러드 필. */
function floodBackground(
  candidate: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const outside = new Uint8Array(candidate.length);
  const stack: number[] = [];
  const push = (index: number) => {
    if (candidate[index] === 1 && outside[index] === 0) {
      outside[index] = 1;
      stack.push(index);
    }
  };
  for (let x = 0; x < width; x += 1) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length > 0) {
    const index = stack.pop()!;
    forEachNeighbor4(index, width, height, push);
  }
  return outside;
}

/** 네 모서리 표본의 성분별 중앙값을 배경 키로 삼는다(한 모서리에 피사체가 걸쳐도 버틴다). */
function estimateBackgroundKey(grid: StudioLift3dSampleGrid): {
  readonly key: readonly [number, number, number];
  readonly spread: number;
} {
  const { width, height, color } = grid;
  const patch = Math.max(1, Math.round(Math.min(width, height) * 0.06));
  const corners: [number, number][] = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  const samples: [number, number, number][] = corners.map(([cx, cy]) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = cy; y < Math.min(height, cy + patch); y += 1) {
      for (let x = cx; x < Math.min(width, cx + patch); x += 1) {
        const index = (y * width + x) * 3;
        r += color[index]!;
        g += color[index + 1]!;
        b += color[index + 2]!;
        count += 1;
      }
    }
    const inverse = count === 0 ? 0 : 1 / count;
    return [r * inverse, g * inverse, b * inverse];
  });
  const median = (channel: 0 | 1 | 2): number => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return (values[1]! + values[2]!) / 2;
  };
  const key: [number, number, number] = [median(0), median(1), median(2)];
  let spread = 0;
  for (const sample of samples) {
    const dr = sample[0] - key[0];
    const dg = sample[1] - key[1];
    const db = sample[2] - key[2];
    spread = Math.max(spread, Math.sqrt((dr * dr + dg * dg + db * db) / 3));
  }
  return { key, spread };
}

function erode(cells: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(cells.length);
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] === 0) continue;
    let keep = 1;
    forEachNeighbor4(index, width, height, (neighbor) => {
      if (cells[neighbor] === 0) keep = 0;
    });
    out[index] = keep;
  }
  return out;
}

function dilate(cells: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(cells);
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] === 0) continue;
    forEachNeighbor4(index, width, height, (neighbor) => {
      out[neighbor] = 1;
    });
  }
  return out;
}

/** 열림(점 노이즈 제거) 후 닫힘(바늘구멍 메우기). 면적은 대체로 보존된다. */
export function despeckleStudioLift3dMask(
  cells: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  return erode(dilate(dilate(erode(cells, width, height), width, height), width, height), width, height);
}

/** 가장 큰 4-연결 성분만 남기고, 버려진 면적 비율을 함께 돌려준다. */
export function keepLargestStudioLift3dPart(
  cells: Uint8Array,
  width: number,
  height: number,
): { readonly cells: Uint8Array; readonly droppedRatio: number } {
  const label = new Int32Array(cells.length).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < cells.length; seed += 1) {
    if (cells[seed] === 0 || label[seed] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    label[seed] = id;
    stack.push(seed);
    while (stack.length > 0) {
      const index = stack.pop()!;
      size += 1;
      forEachNeighbor4(index, width, height, (neighbor) => {
        if (cells[neighbor] === 1 && label[neighbor] === -1) {
          label[neighbor] = id;
          stack.push(neighbor);
        }
      });
    }
    sizes.push(size);
  }
  if (sizes.length <= 1) return { cells, droppedRatio: 0 };
  let best = 0;
  let total = 0;
  for (let id = 0; id < sizes.length; id += 1) {
    total += sizes[id]!;
    if (sizes[id]! > sizes[best]!) best = id;
  }
  const out = new Uint8Array(cells.length);
  for (let index = 0; index < cells.length; index += 1) {
    if (label[index] === best) out[index] = 1;
  }
  return { cells: out, droppedRatio: total === 0 ? 0 : (total - sizes[best]!) / total };
}

export function studioLift3dMaskBounds(
  cells: Uint8Array,
  width: number,
  height: number,
): StudioLift3dMaskBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y * width + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function resolveMaskMode(
  requested: StudioLift3dMaskMode,
  grid: StudioLift3dSampleGrid,
  warnings: StudioLift3dWarning[],
): StudioLift3dResolvedMaskMode {
  if (requested !== "auto") return requested;
  if (studioLift3dHasUsableAlpha(grid)) return "alpha";
  warnings.push(studioLift3dWarning(
    "alpha-absent",
    "알파 채널이 없어 테두리 배경색을 키로 잡아 실루엣을 분리했습니다",
  ));
  return "key";
}

/**
 * 작업 격자에서 피사체 실루엣을 뽑는다.
 *
 * `key` 모드는 "배경색과 비슷한 셀"을 곧장 배경으로 삼지 않고, 테두리에서 플러드 필로 실제
 * 도달 가능한 영역만 배경으로 확정한다. 캐릭터 안쪽의 배경색과 같은 면(흰 셔츠, 하늘색 눈동자)이
 * 구멍으로 뚫리지 않게 하려는 것이다.
 */
export function extractStudioLift3dMask(
  grid: StudioLift3dSampleGrid,
  options: StudioLift3dMaskOptions = {},
): StudioLift3dMask {
  const { width, height } = grid;
  const cellCount = width * height;
  const warnings: StudioLift3dWarning[] = [];
  const mode = resolveMaskMode(options.mode ?? "auto", grid, warnings);
  let cells: Uint8Array = new Uint8Array(cellCount);

  if (mode === "full") {
    cells.fill(1);
  } else if (mode === "alpha") {
    const threshold = clamp01(options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD);
    for (let index = 0; index < cellCount; index += 1) {
      cells[index] = grid.alpha[index]! >= threshold ? 1 : 0;
    }
  } else {
    const tolerance = clamp01(options.keyTolerance ?? DEFAULT_KEY_TOLERANCE);
    const { key, spread } = estimateBackgroundKey(grid);
    if (spread > Math.max(tolerance, 0.05)) {
      warnings.push(studioLift3dWarning(
        "background-key-ambiguous",
        "모서리마다 배경색이 달라 실루엣 분리가 부정확할 수 있습니다. 배경을 지운 PNG 를 쓰면 정확해집니다",
      ));
    }
    const candidate = new Uint8Array(cellCount);
    const alphaThreshold = clamp01(options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD);
    for (let index = 0; index < cellCount; index += 1) {
      if (grid.alpha[index]! < alphaThreshold) {
        candidate[index] = 1;
        continue;
      }
      const dr = grid.color[index * 3]! - key[0];
      const dg = grid.color[index * 3 + 1]! - key[1];
      const db = grid.color[index * 3 + 2]! - key[2];
      candidate[index] = Math.sqrt((dr * dr + dg * dg + db * db) / 3) <= tolerance ? 1 : 0;
    }
    const outside = floodBackground(candidate, width, height);
    for (let index = 0; index < cellCount; index += 1) {
      cells[index] = outside[index] === 1 ? 0 : 1;
    }
  }

  if (mode !== "full" && (options.despeckle ?? true)) {
    cells = despeckleStudioLift3dMask(cells, width, height);
  }
  if (mode !== "full" && (options.keepLargestPart ?? false)) {
    const largest = keepLargestStudioLift3dPart(cells, width, height);
    cells = largest.cells;
    if (largest.droppedRatio > DROPPED_PART_NOTICE_RATIO) {
      warnings.push(studioLift3dWarning(
        "detached-parts-dropped",
        `본체에서 떨어진 조각 ${Math.round(largest.droppedRatio * 100)}% 를 제외했습니다`,
      ));
    }
  }

  let filled = 0;
  for (let index = 0; index < cellCount; index += 1) filled += cells[index]!;
  const coverage = cellCount === 0 ? 0 : filled / cellCount;
  if (coverage > 0 && coverage < STUDIO_LIFT3D_LIMITS.thinSubjectCoverage) {
    warnings.push(studioLift3dWarning(
      "thin-subject",
      "피사체가 화면에서 작아 디테일이 뭉개질 수 있습니다. 원화를 잘라 확대하면 좋아집니다",
    ));
  }

  return {
    width,
    height,
    cells,
    bounds: studioLift3dMaskBounds(cells, width, height),
    coverage,
    mode,
    warnings: Object.freeze(warnings),
  };
}
