/**
 * Studio Seamless Tile Raster — 브라우저 셸(DOM 경계).
 * 패턴 스펙의 SVG 타일 1장을 캔버스로 래스터라이즈해 순수 엔진
 * (studio-seamless-tile)이 먹는 RGBA 픽셀(SeamlessTileImage)로 바꾸고,
 * 엔진 산출 픽셀을 <canvas>에 그리는 두 가지 얇은 어댑터만 담당한다.
 * "캔버스에서 픽셀을 꺼내고 → 순수 계산 → 캔버스에 되돌린다" 관례
 * (studio-content-aware-fill·studio-brush-tip-import)를 그대로 따른다.
 *
 * 캔버스 2D/Image가 없는 환경(jsdom·SSR)에서는 throw 대신 null/false를
 * 돌려줘 패널이 "분석 불가" 안내로 조용히 강등되게 한다. 패널 테스트는
 * 이 모듈 대신 합성 픽셀을 주입한다(rasterizeTile prop).
 */

import {
  getPatternDef,
  loadPatternTileImage,
  normalizePatternSpec,
  patternDataUrl,
  type StudioPatternSpec,
} from "./studio-pattern-fill";

import type { SeamlessTileImage } from "./studio-seamless-tile";

/** 스펙 → 타일 픽셀 함수 형태 — 패널이 주입받는 계약(테스트는 합성 픽셀 반환). */
export type SeamlessTileRasterizer = (spec: StudioPatternSpec) => Promise<SeamlessTileImage | null>;

/** 래스터 상한(px) — 이 이하가 되도록 정수 배율을 고른다(픽셀 연산 예산 가드). */
const MAX_RASTER_SIZE = 96;

/** SVG 타일(12~36px)을 또렷하게 볼 정수 확대 배율 — 상한 안에서 최대, 최소 1. */
function tileRasterScale(tile: number): number {
  return Math.max(1, Math.floor(MAX_RASTER_SIZE / tile));
}

/**
 * 패턴 스펙 → 타일 1장 RGBA 픽셀. 배율(scale)은 캔버스 fillPatternScale 몫이라
 * 무시하고 항상 원본 타일 좌표계(정수 확대)로 래스터한다 — 이음새 분석이
 * 배율 슬라이더와 무관하게 동일한 답을 내는 이유다.
 * 캔버스 2D 미지원/이미지 로드 실패 시 null(패널이 안내문으로 강등).
 */
export async function rasterizePatternTile(spec: StudioPatternSpec): Promise<SeamlessTileImage | null> {
  if (typeof document === "undefined" || typeof Image === "undefined") return null;
  const safe = normalizePatternSpec(spec);
  const def = getPatternDef(safe.patternId);
  const scale = tileRasterScale(def.tile);
  const size = def.tile * scale;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context == null) return null;

  try {
    const image = await loadPatternTileImage(patternDataUrl(safe), () => new Image());
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    const pixels = context.getImageData(0, 0, size, size);
    return { width: size, height: size, data: pixels.data };
  } catch {
    return null;
  }
}

/**
 * 엔진 산출 픽셀을 캔버스에 그린다(캔버스 크기를 픽셀 크기로 동기화).
 * 성공 여부를 돌려주고, 2D 컨텍스트/ImageData가 없는 환경에서는 false.
 */
export function drawSeamlessTileToCanvas(canvas: HTMLCanvasElement, image: SeamlessTileImage): boolean {
  if (typeof ImageData === "undefined") return false;
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (context == null || typeof context.putImageData !== "function") return false;
  // createImageData 경유 — Uint8ClampedArray<ArrayBufferLike> 제네릭과 DOM ImageData 시그니처 충돌 회피.
  const out = context.createImageData(image.width, image.height);
  out.data.set(image.data);
  context.putImageData(out, 0, 0);
  return true;
}
