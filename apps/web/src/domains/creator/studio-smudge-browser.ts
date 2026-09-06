/** Browser orchestration for the pure Smudge engine. */
import {
  planStudioRasterRetouchRegion,
  translateStudioRasterRetouchPoints,
} from "./render/studio-raster-retouch-region";
import { flipNormalizedPoint } from "./studio-magic-wand";
import {
  encodeStudioRetouchCanvasPng,
  loadStudioRetouchSourceImage,
  studioRetouchSourceDimensions,
} from "./studio-retouch-browser";
import { runStudioSmudgeWorker } from "./studio-smudge-worker-client";

import type { SelPoint } from "./studio-selection-tools";
import type { SmudgePixelPoint } from "./studio-smudge";

/**
 * 문지르기 브러시 — src 이미지에 정규화 스트로크(요소 로컬 0..1, canvasPointToNormalized 로 만든
 * SelPoint 그대로, 화면에 표시된 대로 — 반전 포함)를 적용한 PNG data URL 을 반환한다.
 * strokePoints.length < 2 또는 strength <= 0 이면 캔버스 작업 자체를 생략하고 src 를 그대로
 * 반환한다(floodFillImage 의 NEAR_IDENTICAL2 조기 반환과 동일한 관례 — 무변화 히스토리 방지).
 *
 * @param radiusNorm 요소 "폭" 대비 정규화 반경(캔버스 px ÷ 요소 폭) — SelectionBrushSubpath 와 동일 규약.
 * @param strength 0..1 (StudioPage 가 smudgeStrength(%)/100 로 변환해서 넘긴다).
 * @param opts.flipX/flipY target.flipped/target.flippedY — flipNormalizedPoint 로 스트로크 점을
 *   원본(비반전) 방향으로 되돌린 뒤 자연 해상도로 스케일해 smudgeStroke 에 넘긴다.
 *
 * 스탬프 블렌드 루프(smudgeStroke)는 대형 이미지·긴 스트로크에서 무거운 동기 작업이라
 * Worker로 옮긴다. 선택한 Worker를 사용할 수 없으면 요청을 실패로 닫고 main-thread로 재실행하지 않는다.
 */
export async function smudgeStrokeImage(
  src: string,
  strokePoints: readonly SelPoint[],
  radiusNorm: number,
  strength: number,
  opts?: { flipX?: boolean; flipY?: boolean; signal?: AbortSignal },
): Promise<string> {
  if (strokePoints.length < 2 || strength <= 0) return src;

  const img = await loadStudioRetouchSourceImage(src, opts?.signal);
  const { width: w, height: h } = studioRetouchSourceDimensions(img);
  if (!w || !h) throw new Error("이미지 크기를 확인할 수 없습니다.");

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.drawImage(img, 0, 0, w, h);

  const flipX = opts?.flipX ?? false;
  const flipY = opts?.flipY ?? false;
  const pixelPoints: SmudgePixelPoint[] = strokePoints.map((p) => {
    const unflipped = flipNormalizedPoint(p, flipX, flipY);
    return { x: unflipped.x * w, y: unflipped.y * h };
  });

  const radiusPx = Number.isFinite(radiusNorm) ? Math.max(1, radiusNorm * w) : 1;
  const region = planStudioRasterRetouchRegion(pixelPoints, radiusPx, w, h);
  if (!region) return src;
  const imageData = ctx.getImageData(region.x, region.y, region.width, region.height);
  const regionPoints = translateStudioRasterRetouchPoints(pixelPoints, region);
  const { data } = await runStudioSmudgeWorker({
    data: imageData.data,
    w: region.width,
    h: region.height,
    points: regionPoints,
    radiusPx,
    strength,
  }, { executionMode: "worker", signal: opts?.signal });

  // ImageData 생성자는 ArrayBuffer 백업 뷰만 받는다 — postMessage 전송은 항상 진짜
  // ArrayBuffer라 안전하지만(SharedArrayBuffer 아님) 타입상 Uint8ClampedArray<ArrayBufferLike>
  // 로 넓어져 있어 새 뷰로 감싸 좁힌다(studio-image-filter-worker-client 관례와 동일).
  ctx.putImageData(
    new ImageData(new Uint8ClampedArray(data), region.width, region.height),
    region.x,
    region.y,
  );
  return encodeStudioRetouchCanvasPng(canvas, { signal: opts?.signal });
}
