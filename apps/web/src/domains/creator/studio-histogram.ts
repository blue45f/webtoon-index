/**
 * Studio Histogram Engine
 * 포토샵/CSP "히스토그램" — 이미지 픽셀의 휘도(luma) 또는 R/G/B 단일 채널 분포를 256칸으로
 * 집계한다. 레벨/톤 커브 패널이 슬라이더·곡선 위에 분포를 보여줄 때 쓴다.
 *
 * 샘플링 규칙(결정적 — 랜덤 없음, 같은 입력이면 항상 같은 결과):
 *   stride = max(1, ceil(sqrt(width*height / STUDIO_HISTOGRAM_MAX_SAMPLES)))
 *   그 뒤 ceil(width/stride)*ceil(height/stride) > 상한이면 상한을 지킬 때까지 stride += 1
 *   (1×N 같은 극단 비율에서 ceil 오차로 상한을 넘는 것을 막는 가드).
 *   격자 위 픽셀 (x % stride === 0 && y % stride === 0)만 읽는다 — 공간적으로 균일한 표본.
 * 완전 투명(alpha 0) 픽셀은 분포에서 제외한다(빈 캔버스 영역이 0번 칸을 오염시키지 않게).
 *
 * computeHistogram은 순수(Konva/DOM 의존 없음) — 단위 테스트와 패널이 공유한다.
 * loadStudioHistogramImageData만 브라우저 전용(HTMLImageElement + 오프스크린 캔버스)이며,
 * 이미지 로드는 기존 studio-canvas-image-io의 abort 안전 로더(loadPixelEditImage)를 재사용한다.
 */

import { loadPixelEditImage } from "./canvas/studio-canvas-image-io";

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 집계 채널 — luma(휘도, Rec.601 가중 0.299/0.587/0.114) 또는 r/g/b 단일 채널. */
export type StudioHistogramChannel = "luma" | "r" | "g" | "b";

export interface StudioHistogramResult {
  /** 256칸 빈도 — bins[v] = 값 v(0..255)로 집계된 표본 픽셀 수. */
  bins: Uint32Array;
  /** 가장 높은 빈의 표본 수(그래프 세로 정규화용). 표본이 없으면 0. */
  max: number;
  /** 표본 평균(반올림하지 않은 소수). 표본이 없으면 0. */
  mean: number;
  /** 하위 중앙값 — 누적 표본이 ceil(n/2)에 처음 도달하는 값. 표본이 없으면 0. */
  median: number;
  /** 0번 칸 표본 수(어두운 끝 잘림/블랙 클리핑). */
  clippedLow: number;
  /** 255번 칸 표본 수(밝은 끝 잘림/화이트 클리핑). */
  clippedHigh: number;
  /** 실제로 집계된 표본 수 — 스트라이드 격자 위의 alpha>0 픽셀 수. */
  sampledPixels: number;
}

/** 표본 상한(512×512) — 이보다 큰 이미지는 격자 스트라이드로 균일 다운샘플한다. */
export const STUDIO_HISTOGRAM_MAX_SAMPLES = 262_144;

/** 히스토그램용 디코드 시 긴 변 상한 — 표본 상한과 짝을 이뤄 디코드 비용도 함께 묶는다. */
export const STUDIO_HISTOGRAM_MAX_DECODE_DIMENSION = 1024;

// ---------------------------------------------------------------------------
// 순수 엔진
// ---------------------------------------------------------------------------

/**
 * 두 축에 공통 적용하는 격자 스트라이드. 문서화된 규칙:
 * ceil(sqrt(total/상한))에서 시작해, ceil 나눗셈 조합이 상한을 넘으면 넘지 않을 때까지 +1.
 */
export function studioHistogramStride(
  width: number,
  height: number,
  maxSamples = STUDIO_HISTOGRAM_MAX_SAMPLES
): number {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1
  ) {
    return 1;
  }
  const budget = Number.isSafeInteger(maxSamples) && maxSamples >= 1 ? maxSamples : STUDIO_HISTOGRAM_MAX_SAMPLES;
  let stride = Math.max(1, Math.ceil(Math.sqrt((width * height) / budget)));
  while (Math.ceil(width / stride) * Math.ceil(height / stride) > budget) stride += 1;
  return stride;
}

function emptyHistogramResult(): StudioHistogramResult {
  return {
    bins: new Uint32Array(256),
    max: 0,
    mean: 0,
    median: 0,
    clippedLow: 0,
    clippedHigh: 0,
    sampledPixels: 0,
  };
}

/**
 * 채널 분포 집계 — 무효 입력(치수/버퍼 길이 불일치)은 빈 결과. 입력 픽셀은 변형하지 않는다.
 * luma는 Rec.601 가중 합을 반올림한 0..255 정수(가중 합=1이라 범위를 벗어나지 않는다).
 */
export function computeHistogram(
  image: StudioImageDataLike,
  channel: StudioHistogramChannel
): StudioHistogramResult {
  const { width, height, data } = image;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isSafeInteger(width * height * 4) ||
    data.length < width * height * 4
  ) {
    return emptyHistogramResult();
  }

  const bins = new Uint32Array(256);
  const stride = studioHistogramStride(width, height);
  const channelOffset = channel === "r" ? 0 : channel === "g" ? 1 : channel === "b" ? 2 : -1;
  let sampledPixels = 0;

  for (let y = 0; y < height; y += stride) {
    const rowStart = y * width;
    for (let x = 0; x < width; x += stride) {
      const offset = (rowStart + x) * 4;
      if (data[offset + 3]! === 0) continue; // 완전 투명 픽셀 제외
      const value =
        channelOffset >= 0
          ? data[offset + channelOffset]!
          : Math.round(0.299 * data[offset]! + 0.587 * data[offset + 1]! + 0.114 * data[offset + 2]!);
      bins[value]! += 1;
      sampledPixels += 1;
    }
  }

  if (sampledPixels === 0) return emptyHistogramResult();

  let max = 0;
  let sum = 0;
  for (let value = 0; value < 256; value++) {
    const count = bins[value]!;
    if (count > max) max = count;
    sum += value * count;
  }

  // 하위 중앙값 — 누적이 ceil(n/2)에 처음 도달하는 값.
  const medianRank = Math.ceil(sampledPixels / 2);
  let median = 0;
  let cumulative = 0;
  for (let value = 0; value < 256; value++) {
    cumulative += bins[value]!;
    if (cumulative >= medianRank) {
      median = value;
      break;
    }
  }

  return {
    bins,
    max,
    mean: sum / sampledPixels,
    median,
    clippedLow: bins[0]!,
    clippedHigh: bins[255]!,
    sampledPixels,
  };
}

// ---------------------------------------------------------------------------
// 브라우저 로더 — data:/blob:/원격 src → 디코드된 RGBA 픽셀 (테스트 대상 아님)
// ---------------------------------------------------------------------------

/**
 * 이미지 src를 히스토그램용 픽셀로 디코드한다. 이미지 로드는 loadPixelEditImage(abort 안전,
 * 비-data: src는 CORS 요청)를 재사용하고, 긴 변을 maxDimension 이하로 축소해 그린 뒤
 * 픽셀을 복사해 반환한다(캔버스 backing store는 즉시 해제). CORS 오염(taint) 등으로
 * getImageData가 거부되면 그대로 reject — 호출측(훅)은 히스토그램만 생략하면 된다.
 */
export async function loadStudioHistogramImageData(
  src: string,
  options: { signal?: AbortSignal; maxDimension?: number } = {}
): Promise<StudioImageDataLike> {
  const maxDimension =
    Number.isFinite(options.maxDimension) && (options.maxDimension ?? 0) >= 1
      ? Math.round(options.maxDimension!)
      : STUDIO_HISTOGRAM_MAX_DECODE_DIMENSION;

  const image = await loadPixelEditImage(src, options.signal);
  if (options.signal?.aborted) {
    throw new DOMException("히스토그램 픽셀 읽기를 취소했습니다.", "AbortError");
  }

  const naturalWidth = image.naturalWidth || image.width;
  const naturalHeight = image.naturalHeight || image.height;
  if (
    !Number.isSafeInteger(naturalWidth) ||
    !Number.isSafeInteger(naturalHeight) ||
    naturalWidth < 1 ||
    naturalHeight < 1
  ) {
    throw new Error("히스토그램용 이미지 크기를 확인할 수 없습니다.");
  }

  const scale = Math.min(1, maxDimension / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  try {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("히스토그램 분석 캔버스를 만들 수 없습니다.");
    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    return { data: new Uint8ClampedArray(imageData.data), width, height };
  } finally {
    // 복사한 RGBA 바이트만 유지하고 캔버스 backing store는 즉시 해제한다.
    canvas.width = 1;
    canvas.height = 1;
  }
}
