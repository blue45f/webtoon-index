/** Canvas-factory orchestration for the pure Heal/Clone engine. */
import { planStudioRasterRetouchRegion } from "./render/studio-raster-retouch-region";
import {
  runStudioHealCloneWorker,
  type StudioHealCloneWorkerClientOptions,
} from "./studio-heal-clone-worker-client";

import type { StudioImageDataLike } from "./studio-filters";
import type { HealCloneBrushSettings, HealCloneDab, HealCloneMode } from "./studio-heal-clone";
import type { MaskCanvasLike, MaskCtx2DLike, MaskImageSource } from "./studio-selection-tools";

/**
 * studio-selection-tools.ts 의 MaskCtx2DLike 를 확장 — 도장 패치를 읽고 네이티브 ImageData로
 * 복원해 쓰려면 get/create/putImageData 가 필요하다(MaskCtx2DLike 엔 없음). StudioPage.tsx 의
 * createPixelEditCanvas 는 이미 진짜 CanvasRenderingContext2D 를 반환하므로 **수정 없이 그대로**
 * 이 자리에 넘길 수 있다(구조적 호환,
 * SelectionCanvasFactory 와 동일한 관례 — 메서드 바이베리언스로 컴파일 검증됨).
 */
export type HealCloneCtx2DLike = MaskCtx2DLike & {
  createImageData(sw: number, sh: number): StudioImageDataLike;
  getImageData(sx: number, sy: number, sw: number, sh: number): StudioImageDataLike;
  putImageData(imageData: StudioImageDataLike, dx: number, dy: number): void;
};

/** 오프스크린 캔버스 팩토리 — DOM 의존부를 호출자(StudioPage)가 주입한다. */
export type HealCloneCanvasFactory = (
  width: number,
  height: number
) => { canvas: MaskCanvasLike & MaskImageSource; ctx: HealCloneCtx2DLike } | null;

export type BakeHealCloneStrokeOptions = StudioHealCloneWorkerClientOptions;

function throwIfHealCloneBakeAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (typeof DOMException === "function") {
    throw new DOMException("복구 브러시 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("복구 브러시 계산을 취소했습니다.");
  error.name = "AbortError";
  throw error;
}

/**
 * 스트로크 전체를 원본에 구워 결과 캔버스를 만든다. dabs 가 비었으면 null(구울 게 없음 — 호출자는
 * patchEl 을 생략해야 한다는 신호) — 이 경우 캔버스를 아예 만들지 않는다(불필요한 DOM 작업 방지).
 * radiusPx 는 **디바이스(자연) px**여야 한다(호출자가 target.width 기준 배율로 변환해서 넘긴다 —
 * buildSelectionMaskPlan 의 featherScale 관례와 동일).
 *
 * 도장 블렌드 루프(applyHealCloneDabs)는 대형 이미지·긴 스트로크에서 무거운 동기 작업이라
 * Worker로 옮긴다. 선택한 Worker를 사용할 수 없으면 요청을 실패로 닫고 동일한 스트로크를
 * main-thread에서 다시 실행하지 않는다.
 * source/destination footprint를 서로 독립된 ROI로 읽고 Worker로 전송한다. 두 지점이 멀어도 사이의
 * untouched bridge 픽셀은 읽거나 복사하지 않는다. 결과 캔버스는 기존 문서/히스토리 계약을 유지하도록
 * 여전히 전체 이미지 크기지만, Worker 입출력은 두 footprint 면적에만 비례한다.
 */
export async function bakeHealCloneStrokeToCanvas(
  source: MaskImageSource,
  width: number,
  height: number,
  dabs: readonly HealCloneDab[],
  brush: HealCloneBrushSettings,
  mode: HealCloneMode,
  createCanvas: HealCloneCanvasFactory,
  options: BakeHealCloneStrokeOptions = {},
): Promise<(MaskCanvasLike & MaskImageSource) | null> {
  throwIfHealCloneBakeAborted(options.signal);
  if (dabs.length === 0) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const sourceRegion = planStudioRasterRetouchRegion(
    dabs.map((dab) => ({ x: dab.srcX, y: dab.srcY })),
    brush.radiusPx,
    w,
    h,
  );
  const destinationRegion = planStudioRasterRetouchRegion(
    dabs.map((dab) => ({ x: dab.destX, y: dab.destY })),
    brush.radiusPx,
    w,
    h,
  );
  // 한쪽 footprint가 이미지와 전혀 만나지 않으면 실제로 바뀔 destination 픽셀도 없다.
  if (!sourceRegion || !destinationRegion) return null;

  // 전체 크기 캔버스는 최종 결과 보존/인코딩용 한 장뿐이다. 원본을 그린 뒤 source/destination을
  // 별도로 읽으므로 겹치는 도장도 source를 스트로크 시작 시점으로 고정하면서 먼 두 영역 사이 픽셀을
  // 한 번도 materialize하지 않는다.
  const work = createCanvas(w, h);
  if (!work) throw new Error("복구 브러시 결과 캔버스를 만들지 못했습니다.");
  work.ctx.drawImage(source, 0, 0);
  throwIfHealCloneBakeAborted(options.signal);

  const frozenData = work.ctx.getImageData(
    sourceRegion.x,
    sourceRegion.y,
    sourceRegion.width,
    sourceRegion.height,
  );
  const workData = sourceRegion.x === destinationRegion.x
    && sourceRegion.y === destinationRegion.y
    && sourceRegion.width === destinationRegion.width
    && sourceRegion.height === destinationRegion.height
    ? {
        data: new Uint8ClampedArray(frozenData.data),
        width: destinationRegion.width,
        height: destinationRegion.height,
      }
    : work.ctx.getImageData(
        destinationRegion.x,
        destinationRegion.y,
        destinationRegion.width,
        destinationRegion.height,
      );
  const localDabs = dabs.map((dab) => ({
    srcX: dab.srcX - sourceRegion.x,
    srcY: dab.srcY - sourceRegion.y,
    destX: dab.destX - destinationRegion.x,
    destY: dab.destY - destinationRegion.y,
  }));

  const { dst } = await runStudioHealCloneWorker({
    src: frozenData,
    dst: workData,
    dabs: localDabs,
    radiusPx: brush.radiusPx,
    hardness: brush.hardness,
    opacity: brush.opacity,
    mode,
  }, { executionMode: "worker", ...options });

  throwIfHealCloneBakeAborted(options.signal);
  // Worker structured clone은 typed pixel buffer를 보존하지만 ImageData prototype까지 보장하지 않는다.
  // putImageData는 plain object를 거부하므로 컨텍스트가 만든 네이티브 wrapper로 ROI를 복원한다.
  const output = work.ctx.createImageData(destinationRegion.width, destinationRegion.height);
  output.data.set(dst.data);
  work.ctx.putImageData(output, destinationRegion.x, destinationRegion.y);
  return work.canvas;
}
