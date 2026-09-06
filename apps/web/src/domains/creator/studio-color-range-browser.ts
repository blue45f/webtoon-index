/**
 * Browser orchestration for the pure Color Range engine — studio-magic-wand-browser.ts 와 동일한
 * 분리(순수 코어는 studio-color-range.ts, 캔버스/이미지 로딩은 여기).
 *
 * 반환되는 마스크/색은 모두 **표시 좌표계**(요소가 flip 되어 있으면 화면에 보이는 그대로) 기준이다.
 */
import {
  buildColorRangeMask,
  flipColorRangeMask,
  type ColorRangeMask,
  type ColorRangeSample,
} from "./studio-color-range";
import {
  createStudioColorRangeWorkerSession,
  type StudioColorRangeWorkerClientResult,
  type StudioColorRangeWorkerSession,
} from "./studio-color-range-worker-client";
import { loadFloodFillSourceImage } from "./studio-flood-fill";
import { MAGIC_WAND_TRACE_MAX_DIM, flipNormalizedPoint } from "./studio-magic-wand";

import type {
  PixelSelection,
  SelectionCombineMode,
} from "./studio-selection-tools";

let defaultColorRangeWorkerSession: StudioColorRangeWorkerSession | null = null;

function colorRangeWorkerSession(): StudioColorRangeWorkerSession {
  defaultColorRangeWorkerSession ??= createStudioColorRangeWorkerSession({
    executionMode: "worker",
  });
  return defaultColorRangeWorkerSession;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    defaultColorRangeWorkerSession?.dispose();
    defaultColorRangeWorkerSession = null;
  });
}

function throwIfColorRangeAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DOMException("색상 범위 선택 계산을 취소했습니다.", "AbortError");
}

/** 원본 이미지를 스캔 해상도(긴 변 maxDim 이하)로 내려 그린 RGBA 버퍼. 마술봉과 동일한 다운스케일 규약. */
async function readScaledImageData(
  src: string,
  maxDim: number,
  signal?: AbortSignal,
): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  throwIfColorRangeAborted(signal);
  const img = await loadFloodFillSourceImage(src, signal);
  throwIfColorRangeAborted(signal);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) throw new Error("이미지 크기를 확인할 수 없습니다.");

  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  const w = Math.max(1, Math.round(naturalW * scale));
  const h = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  try {
    ctx.imageSmoothingEnabled = false; // 다운스케일 시 색 경계가 번지지 않도록(색 매칭 안정화).
    ctx.drawImage(img, 0, 0, w, h);
    throwIfColorRangeAborted(signal);
    const data = ctx.getImageData(0, 0, w, h).data;
    throwIfColorRangeAborted(signal);
    return { data, w, h };
  } finally {
    // Release the backing store promptly after transfer capture, including abort/error paths.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * 이미지 src + 표시 좌표(0..1) → 그 지점의 원본 픽셀 색(RGB 샘플).
 *
 * 스테이지 캔버스(pickCanvasColorAt)가 아니라 **원본 소스**에서 읽는다 — 색상 범위 엔진이 원본
 * 픽셀을 스캔하므로 샘플도 같은 픽셀에서 와야 Konva 필터/오버레이/줌 보간에 흔들리지 않는다.
 * 완전 투명 픽셀은 RGB 가 무의미하므로 에러로 알린다(페이지가 setError 로 안내).
 */
export async function sampleImageColorAt(
  src: string,
  xRatio: number,
  yRatio: number,
  opts?: { flipX?: boolean; flipY?: boolean; maxDim?: number },
): Promise<ColorRangeSample> {
  const { data, w, h } = await readScaledImageData(src, opts?.maxDim ?? MAGIC_WAND_TRACE_MAX_DIM);
  const p = flipNormalizedPoint({ x: xRatio, y: yRatio }, opts?.flipX ?? false, opts?.flipY ?? false);
  const px = Math.min(w - 1, Math.max(0, Math.round(p.x * w)));
  const py = Math.min(h - 1, Math.max(0, Math.round(p.y * h)));
  const idx = (py * w + px) * 4;
  if ((data[idx + 3] ?? 0) === 0) {
    throw new Error("투명한 지점에서는 색을 추출할 수 없어요. 불투명한 픽셀을 클릭해 주세요.");
  }
  return { r: data[idx]!, g: data[idx + 1]!, b: data[idx + 2]! };
}

/**
 * 이미지 src + 샘플 색들 + fuzziness → 표시 좌표계 소프트 마스크.
 *
 * 색 유사도는 공간과 무관하므로 원본(비반전) 픽셀로 마스크를 만든 뒤 flipColorRangeMask 로 표시
 * 좌표계로 뒤집는다 — magicWandScanFromImage 의 flip 규약과 동일한 결과를 더 싸게 얻는 경로.
 * 하위 호환용 순수 마스크 API다. Studio의 실제 선택 적용 경로는 아래
 * colorRangeSelectionFromImage를 통해 전체 스캔·영역 추적을 Worker에서 실행한다.
 */
export async function colorRangeScanFromImage(
  src: string,
  samples: readonly ColorRangeSample[],
  fuzziness: number,
  opts?: { antiAlias?: boolean; maxTraceDim?: number; flipX?: boolean; flipY?: boolean },
): Promise<ColorRangeMask> {
  const { data, w, h } = await readScaledImageData(src, opts?.maxTraceDim ?? MAGIC_WAND_TRACE_MAX_DIM);
  const mask = buildColorRangeMask(data, w, h, samples, fuzziness, { antiAlias: opts?.antiAlias });
  return flipColorRangeMask(mask, opts?.flipX ?? false, opts?.flipY ?? false);
}

export interface ColorRangeSelectionFromImageOptions {
  antiAlias?: boolean;
  maxTraceDim?: number;
  flipX?: boolean;
  flipY?: boolean;
  selection: PixelSelection | null;
  combineMode: SelectionCombineMode;
  aspect?: number;
  signal?: AbortSignal;
}

/**
 * Production Color Range entry point. Only image decode/downscale/getImageData remains on the
 * browser thread; range scan, intersection, connected components, and contour tracing run in one
 * persistent module Worker request. The captured RGBA buffer transfers ownership without copying.
 */
export async function colorRangeSelectionFromImage(
  src: string,
  samples: readonly ColorRangeSample[],
  fuzziness: number,
  options: ColorRangeSelectionFromImageOptions,
): Promise<StudioColorRangeWorkerClientResult> {
  const { data, w, h } = await readScaledImageData(
    src,
    options.maxTraceDim ?? MAGIC_WAND_TRACE_MAX_DIM,
    options.signal,
  );
  throwIfColorRangeAborted(options.signal);
  return colorRangeWorkerSession().run({
    data,
    width: w,
    height: h,
    samples,
    fuzziness,
    antiAlias: options.antiAlias,
    flipX: options.flipX,
    flipY: options.flipY,
    selection: options.selection,
    combineMode: options.combineMode,
    aspect: options.aspect,
  }, { signal: options.signal });
}
