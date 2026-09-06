/**
 * Studio Alpha Lock — 레이어(요소) 투명도 잠금.
 * 켜면 그 레이어에 대한 이후 "칠하기" 계열 편집(현재는 페인트 통)이 레이어가 지금 갖고 있는
 * 알파(불투명 영역) 밖으로 절대 번지지 않는다 — 별도 클리핑 마스크 레이어 없이 셀 위에 바로
 * 음영을 올리는 전형적 워크플로(Procreate Alpha Lock과 동일 개념).
 *
 * 핵심은 compositeAlphaLocked 하나뿐이다: "편집 전" 원본과 "편집 후" 결과 두 장을 같은 캔버스에
 * 원본 → source-atop → 편집후 순서로 그린다. Porter-Duff source-atop은 결과 알파를
 * destination(원본) 알파 그대로 고정하고 색만 source(편집후) 것으로 갈아 끼운다 — 그래서 원래
 * 투명했던 픽셀은 편집후 뭘 칠했든 영원히 투명하고, 원래 불투명했던 픽셀만 새 색으로 바뀐다.
 * ClipMaskGroup.tsx가 렌더 타임에 같은 Porter-Duff 계열(source-in)로 "다른 레이어"의 알파에
 * 맞춰 자르는 것과 발상은 같지만, 여긴 커밋 타임(data URL 확정)에 "같은 레이어의 이전 프레임"
 * 알파에 맞춰 자른다는 점이 다르다 — 그래서 Konva 캐시 트릭이 필요 없고, 오프스크린 2D 캔버스
 * 합성 한 번으로 끝난다.
 *
 * 전부 순수 함수 — 이미지 로드와 캔버스 생성은 호출부(StudioPage)가 주입한다.
 * studio-selection-tools.ts의 MaskImageSource/MaskCanvasLike/SelectionCanvasFactory를 그대로
 * 재사용한다(같은 추상화를 두 벌 만들지 않는다 — createPixelEditCanvas가 이미 그 팩토리를
 * 구현해 두 모듈 모두에 주입되고 있다). DOM 의존 0 — studio-selection-tools.test.ts와 동일한
 * fakeCtx/fakeFactory(호출 기록) 패턴으로 유닛 테스트한다.
 */
import type { MaskCanvasLike, MaskCtx2DLike, MaskImageSource, SelectionCanvasFactory } from "./studio-selection-tools";

/** StudioPage El의 최소 부분집합(이 모듈은 이 형태만 본다) — studio-layers.ts의 LayerItemLike와 동일한 취지. */
export type AlphaLockLayerLike = { type?: string; alphaLocked?: boolean };

/** 알파 락이 의미를 갖는 레이어인지 — 자체 래스터(src) 픽셀을 가진 "image" 요소만. */
export function canAlphaLock(el: AlphaLockLayerLike): boolean {
  return el.type === "image";
}

/**
 * 유효 알파 락 — el.alphaLocked가 true이고 canAlphaLock(el)도 true일 때만. image가 아닌 요소에
 * 잘못 alphaLocked:true가 붙어 있어도(있을 수 없지만 방어적으로) 무시한다 — 호출부는 항상 이
 * 함수만 확인하면 되고, "type === image"와 "alphaLocked" 두 조건을 따로 조합할 필요가 없다.
 */
export function shouldClipToExistingAlpha(el: AlphaLockLayerLike): boolean {
  return canAlphaLock(el) && !!el.alphaLocked;
}

export interface AlphaLockedRasterPixels {
  /** Edited RGB with alpha forced to the lock source. Always owns a new buffer. */
  data: Uint8ClampedArray;
  /** Pixels whose final RGBA differs from the immediately preceding preview/source. */
  changedPixelCount: number;
}

/**
 * Applies Alpha Lock exactly at pixel level for Advanced Fill.
 *
 * `lockSource` supplies the immutable alpha silhouette, `before` is the immediately preceding
 * preview (for exact incremental diagnostics), and `edited` is the new fill result. Copying RGB
 * directly avoids repeatedly source-atop blending partially transparent antialiased edges during
 * continuous fills. Fully transparent pixels retain `before` verbatim so hidden RGB bytes do not
 * create false changed-pixel counts.
 */
export function applyAlphaLockToRasterPixels(
  lockSource: Uint8ClampedArray,
  before: Uint8ClampedArray,
  edited: Uint8ClampedArray,
): AlphaLockedRasterPixels {
  if (
    lockSource.length !== before.length ||
    lockSource.length !== edited.length ||
    lockSource.length % 4 !== 0
  ) {
    throw new RangeError("Alpha Lock pixel buffers must be equal RGBA arrays.");
  }

  const data = new Uint8ClampedArray(edited.length);
  let changedPixelCount = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const lockedAlpha = lockSource[offset + 3]!;
    if (lockedAlpha === 0) {
      data[offset] = before[offset]!;
      data[offset + 1] = before[offset + 1]!;
      data[offset + 2] = before[offset + 2]!;
      data[offset + 3] = before[offset + 3]!;
    } else {
      data[offset] = edited[offset]!;
      data[offset + 1] = edited[offset + 1]!;
      data[offset + 2] = edited[offset + 2]!;
      data[offset + 3] = lockedAlpha;
    }
    if (
      data[offset] !== before[offset] ||
      data[offset + 1] !== before[offset + 1] ||
      data[offset + 2] !== before[offset + 2] ||
      data[offset + 3] !== before[offset + 3]
    ) {
      changedPixelCount += 1;
    }
  }
  return { data, changedPixelCount };
}

/**
 * 알파 락 합성 — edited(편집 결과)를 original(편집 전 알파 모양) 밖으로 나가지 않게 오려낸다.
 * 과거 Porter-Duff "source-atop" 기반 합성에서는 부분 투명 픽셀에서 기존 색상과 새 색상이 
 * 섞이는 문제가 있었으나, 현재는 getImageData/putImageData를 사용하여 픽셀 단위로 정확히 
 * RGB는 edited, Alpha는 original을 강제하도록 구현되었다. 투명한 부분은 원래 색상을 유지한다.
 * width/height는 두 이미지가 공유하는 자연 픽셀 크기(가공 없이 "같은 캔버스 크기의 이전/이후
 * 프레임"이라는 전제 — 크롭처럼 크기 자체가 바뀌는 편집에는 쓰지 않는다). 팩토리가 null(2D
 * 컨텍스트 획득 실패)이면 null.
 */

export type AlphaLockCtx2DLike = MaskCtx2DLike & {
  getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(imagedata: { data: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number): void;
};

export function compositeAlphaLocked(
  original: MaskImageSource,
  edited: MaskImageSource,
  width: number,
  height: number,
  createCanvas: SelectionCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const out = createCanvas(w, h);
  if (!out) return null;

  const outCtx = out.ctx as AlphaLockCtx2DLike;

  outCtx.drawImage(original, 0, 0);
  const origData = outCtx.getImageData(0, 0, w, h);

  outCtx.clearRect(0, 0, w, h);
  outCtx.drawImage(edited, 0, 0);
  const editedData = outCtx.getImageData(0, 0, w, h);

  for (let i = 0; i < origData.data.length; i += 4) {
    const alpha = origData.data[i + 3]!;
    if (alpha === 0) {
      editedData.data[i] = origData.data[i]!;
      editedData.data[i + 1] = origData.data[i + 1]!;
      editedData.data[i + 2] = origData.data[i + 2]!;
      editedData.data[i + 3] = 0;
    } else {
      editedData.data[i + 3] = alpha;
    }
  }

  outCtx.putImageData(editedData, 0, 0);
  return out.canvas;
}
