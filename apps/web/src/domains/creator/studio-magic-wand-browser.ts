/** Browser orchestration for the pure Magic Wand engine. */
import { loadFloodFillSourceImage } from "./studio-flood-fill";
import {
  MAGIC_WAND_TOLERANCE_DEFAULT,
  MAGIC_WAND_TRACE_MAX_DIM,
  flipMagicWandRegion,
  flipNormalizedPoint,
  type MagicWandRegion,
} from "./studio-magic-wand";
import { runStudioMagicWandWorker } from "./studio-magic-wand-worker-client";
import {
  MAGNETIC_LASSO_FIELD_MAX_DIM,
  luminanceFieldFromRgba,
  type SelectionLuminanceField,
} from "./studio-selection-tools";

/**
 * 이미지 src + 클릭 지점(표시 좌표 0..1, 요소가 flip 되어 있으면 표시된 그대로) → MagicWandRegion
 * (표시 좌표계로 되돌려진 채로 반환 — 그대로 addSelectionSubpath/PixelSelection 에 넣으면 된다).
 * @param opts.flipX/flipY 대상 이미지 요소의 좌우/상하 반전(ImageEl.flipped/flippedY) — 원본
 *   픽셀은 항상 비반전 상태로 저장되므로, 샘플 지점은 원본 좌표로 뒤집어 스캔하고 결과 폴리곤은
 *   다시 표시 좌표로 뒤집는다(buildSelectionMaskPlan 의 flipX/flipY 처리와 동일한 규약).
 */
export async function magicWandScanFromImage(
  src: string,
  xRatio: number,
  yRatio: number,
  tolerance = MAGIC_WAND_TOLERANCE_DEFAULT,
  opts?: { maxTraceDim?: number; flipX?: boolean; flipY?: boolean },
): Promise<MagicWandRegion> {
  const img = await loadFloodFillSourceImage(src);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) throw new Error("이미지 크기를 확인할 수 없습니다.");

  const maxDim = opts?.maxTraceDim ?? MAGIC_WAND_TRACE_MAX_DIM;
  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  const traceW = Math.max(1, Math.round(naturalW * scale));
  const traceH = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = traceW;
  canvas.height = traceH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.imageSmoothingEnabled = false; // 다운스케일 시 색 경계가 번지지 않도록(허용 오차 매칭 안정화).
  ctx.drawImage(img, 0, 0, traceW, traceH);
  const { data } = ctx.getImageData(0, 0, traceW, traceH);

  const flipX = opts?.flipX ?? false;
  const flipY = opts?.flipY ?? false;
  const sampleP = flipNormalizedPoint({ x: xRatio, y: yRatio }, flipX, flipY);
  const startX = Math.min(traceW - 1, Math.max(0, Math.round(sampleP.x * traceW)));
  const startY = Math.min(traceH - 1, Math.max(0, Math.round(sampleP.y * traceH)));

  // 플러드필+윤곽 추적(scanMagicWandRegionFromImageData)은 대형/스크린톤 이미지에서 0.5초+
  // 걸릴 수 있는 무거운 작업이라 Worker로 옮긴다. Worker를 사용할 수 없으면 선택을 실패로 닫고
  // 동일 요청을 main-thread에서 다시 실행하지 않는다.
  const { region } = await runStudioMagicWandWorker(
    {
      data,
      w: traceW,
      h: traceH,
      startX,
      startY,
      tolerance,
    },
    { executionMode: "worker" },
  );
  const displayRegion = flipMagicWandRegion(region, flipX, flipY);
  if (displayRegion.outer.length < 3) throw new Error("이 지점에서 선택할 영역을 찾지 못했어요.");
  return displayRegion;
}

/**
 * 이미지 src → 자석 올가미 휘도장(다운스케일, 표시 좌표계). 자석 올가미(2026-07-24)의 순수
 * 스냅 코어(snapLassoPointToEdge)에 주입할 픽셀 샘플러를 만든다.
 * @param opts.flipX/flipY 대상 이미지 요소의 좌우/상하 반전 — 캔버스 변환으로 표시된 모습
 *   그대로 그려서 휘도장 좌표축이 선택 정규화 좌표축과 항상 일치하게 한다.
 */
export async function sampleImageLuminanceField(
  src: string,
  opts?: { maxDim?: number; flipX?: boolean; flipY?: boolean },
): Promise<SelectionLuminanceField> {
  const img = await loadFloodFillSourceImage(src);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) throw new Error("이미지 크기를 확인할 수 없습니다.");

  const maxDim = opts?.maxDim ?? MAGNETIC_LASSO_FIELD_MAX_DIM;
  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH));
  const fieldW = Math.max(1, Math.round(naturalW * scale));
  const fieldH = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = fieldW;
  canvas.height = fieldH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 만들 수 없습니다.");
  ctx.translate(opts?.flipX ? fieldW : 0, opts?.flipY ? fieldH : 0);
  ctx.scale(opts?.flipX ? -1 : 1, opts?.flipY ? -1 : 1);
  ctx.drawImage(img, 0, 0, fieldW, fieldH);
  const { data } = ctx.getImageData(0, 0, fieldW, fieldH);
  const field = luminanceFieldFromRgba(data, fieldW, fieldH);
  if (!field) throw new Error("이미지의 휘도장을 만들 수 없습니다.");
  return field;
}
