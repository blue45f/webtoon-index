/**
 * Studio Layer Mask — Photoshop 레이어 마스크(비파괴) 순수 코어.
 *
 * 개념: image 요소에 원본 픽셀(el.src)과는 별도로 그레이스케일 알파 맵(el.maskSrc, PNG data URL)을
 * 하나 더 둔다. 흰색=완전히 보임, 검정=완전히 숨김, 회색=반투명 — Photoshop과 동일한 관례다. 마스크를
 * 지우거나 다시 그려도 el.src(원본 래스터)는 전혀 건드리지 않는다 — 그래서 "비파괴"다. 이 점에서
 * el.clipBelow(바로 아래 레이어의 알파 "모양"으로 자르는, 다른 레이어에 종속된 클리핑)와는 다른
 * 축의 기능이다 — 마스크는 자기 자신만으로 완결되고, 같은 요소에 둘 다 걸 수도 있다(교집합 합성,
 * 통합 시 StudioPage.tsx 렌더 루프가 처리 — 이 파일은 렌더링에 관여하지 않는다).
 *
 * 인코딩 선택(중요 — 왜 "그레이스케일 RGB"가 아니라 "알파 채널"인가): maskSrc PNG는 RGB를
 * 흰색(#ffffff)으로 고정하고 마스크 값 자체를 **알파 채널**에 담는다(alpha=0..255가 곧 가시성).
 * 이유는 두 가지: (1) 이러면 ClipMaskGroup.tsx가 clipBelow에 이미 쓰는 것과 완전히 동일한
 * Porter-Duff 트릭(자식을 "source-in"으로 형제의 알파에 대고 자르는 것)을 그대로 재사용할 수
 * 있다 — 별도의 "휘도를 알파로 변환하는" getImageData 왕복이 전혀 필요 없다. (2) SVG는 <mask>
 * 안에 <image>를 넣으면 그 이미지 자신의 알파가 최종 마스크 값에 곱연산으로 반영되므로(SVG 스펙,
 * mask-type="luminance" 기본값이라도 RGB가 항상 흰색=휘도 1이면 사실상 알파만 남는다),
 * studio-svg-export.ts에서도 무손실로 그대로 내보낼 수 있다(§design 문서 참고).
 * 부작용: 마스크를 "미리보기 썸네일"로 보여줄 때는 검은 배경 위에 이 PNG를 그대로 얹으면 된다 —
 * 알파가 낮은 픽셀은 검은 배경이 비쳐 자동으로 "어둡게" 보이고, 알파가 높은 픽셀은 흰색 그대로
 * 보여 표준 포토샵 마스크 썸네일과 시각적으로 동일하게 읽힌다(별도 변환 코드 불필요).
 *
 * "반전"은 상태 플래그가 아니라 즉시 굽는(bake) 동작이다(invertLayerMaskAlpha) — Photoshop의
 * Ctrl/Cmd+I도 마스크 썸네일 위에서는 실제로 마스크 픽셀 자체를 뒤집지, 렌더링 시점 플래그가
 * 아니다. 렌더-타임 비파괴 반전(Konva 필터로 알파를 뒤집는 것)은 캔버스 2D에 "휘도→알파" 변환
 * 없이는 흉내 낼 방법이 마땅치 않아(내장 Invert 필터는 RGB만 뒤집고 알파는 그대로 둔다)
 * 포기했다 — 대신 즉시 굽기 쪽이 정확하고 단순하며, 여전히 el.src는 전혀 건드리지 않으므로
 * "비파괴" 원칙(이미지 자체는 무손실)은 유지된다. patchEl을 통해 히스토리(⌘Z) 1건으로 남는다.
 *
 * studio-alpha-lock.ts/studio-color-to-alpha.ts와 동일한 스타일: 전부 순수 함수, 이미지 로드와
 * 오프스크린 캔버스 생성은 전부 호출부(StudioPage)가 주입한다(SelectionCanvasFactory).
 * DOM 의존 0 — studio-selection-tools.test.ts/studio-alpha-lock.test.ts와 동일한 fakeCtx/
 * fakeFactory(호출 기록) 패턴으로 유닛 테스트한다. studio-selection-tools.ts의
 * MaskImageSource/MaskCanvasLike/MaskCtx2DLike/SelectionCanvasFactory를 그대로 재사용한다
 * (같은 추상화를 두 벌 만들지 않는다 — alpha-lock 모듈과 동일한 이유).
 *
 * 브러시 스트로크를 굽는 방식은 studio-selection-tools.ts의 paintSelectionMaskSteps와 동일하게
 * "벡터 스트로크(round cap/join, lineWidth=2×반경)"다 — studio-smudge.ts처럼 픽셀 단위
 * Uint8ClampedArray 루프를 도는 대신, 브라우저의 안티앨리어싱된 스트로크 렌더링에 맡긴다(마스크
 * 페인팅은 "선택 영역을 브러시로 그리는 것"과 본질적으로 같은 문제라 studio-selection-tools의
 * 브러시 방식이 자연스러운 선례다). 강도(strength)는 ctx.globalAlpha 대신 strokeStyle/fillStyle을
 * "rgba(255,255,255,강도)" 문자열로 인코딩해서 표현한다 — MaskCtx2DLike에 globalAlpha 멤버가
 * 없어도(그리고 추가하지 않고도) Porter-Duff 합성 공식상 동일한 결과를 내기 때문이다(fillStyle/
 * strokeStyle의 알파는 소스 알파로 그대로 합성 공식에 들어간다). 경도(hardness)는
 * rasterizeSelectionMask의 페더 단계와 동일하게 ctx.filter = "blur(Npx)"로 근사한다.
 *
 * 좌표 규약: 브러시 스트로크 점(LayerMaskPixelPoint)은 이미지의 "자연 픽셀" 좌표(el.src를
 * loadPixelEditImage로 읽었을 때의 naturalWidth/naturalHeight 기준), 화면 반전(flipX/flipY)은
 * 이미 되돌려진 상태로 이 모듈에 들어와야 한다(studio-heal-clone.ts의 HealCloneDab, studio-
 * smudge.ts의 SmudgePixelPoint와 동일한 규약 — 다만 이 모듈은 그 타입들을 재사용하지 않고 독립
 * 정의한다: studio-heal-clone.ts도 studio-smudge.ts의 SmudgePixelPoint를 재사용하지 않고 자체
 * 타입을 두는 것과 동일한 선례 — 서로 다른 브러시 도구가 우연히 구조가 같다고 묶으면 한쪽만
 * 바뀔 미래 변경에 취약해진다). maskSrc 캔버스의 픽셀 크기는 반드시 el.src와 "같은 자연 해상도"
 * 기준이어야 화면 표시(el.width/height로 스케일)에서 1:1로 정렬된다 — 크롭처럼 el.src의 자연
 * 해상도 자체가 바뀌는 편집을 하면 기존 maskSrc는 좌표계가 어긋난다(§design 문서의 알려진 한계 참고).
 */
import type { MaskCanvasLike, MaskCtx2DLike, MaskImageSource, SelectionCanvasFactory } from "../studio-selection-tools";

// ---------------------------------------------------------------------------
// (A) 타입 · 술어(predicate)
// ---------------------------------------------------------------------------

/** StudioPage El의 최소 부분집합(이 모듈은 이 형태만 본다) — AlphaLockLayerLike와 동일한 취지. */
export type LayerMaskLike = { type?: string; maskSrc?: string; maskEnabled?: boolean };

/** 마스크가 의미를 갖는 레이어인지 — 자체 래스터(src) 픽셀을 가진 "image" 요소만(canAlphaLock과 동일 조건). */
export function canLayerMask(el: LayerMaskLike): boolean {
  return el.type === "image";
}

/** 마스크 데이터가 있는지(켜짐/꺼짐과 무관 — "삭제"와 "비활성화"를 구분하기 위한 존재 술어). */
export function hasLayerMask(el: LayerMaskLike): boolean {
  return !!el.maskSrc;
}

/**
 * 유효 마스크 적용 여부 — image이고, maskSrc가 있고, maskEnabled가 명시적으로 false가 아닐 때.
 * (shouldClipToExistingAlpha와 동일한 3중 방어 패턴: image가 아닌 요소에 잘못 필드가 붙어 있어도
 * 무시한다.) 호출부(StudioPage 렌더 루프)는 항상 이 함수 하나만 확인하면 된다.
 */
export function shouldApplyLayerMask(el: LayerMaskLike): boolean {
  return canLayerMask(el) && hasLayerMask(el) && el.maskEnabled !== false;
}

/** 마스크 초기 채움 — "reveal"(흰 마스크, 전체 보임)이 Photoshop "레이어 마스크 추가"의 기본,
 * "conceal"(검정 마스크, 전체 숨김)이 Alt/Option+클릭 변형에 대응한다. 브러시 모드에도 재사용
 * (흰 브러시=칠하면 드러남=reveal, 검정 브러시=칠하면 감춰짐=conceal — 동일 어휘). */
export type LayerMaskPaintMode = "reveal" | "conceal";

/** 브러시 스트로크 점 — 자연 픽셀 좌표(화면 반전 이미 걷힌 상태). 독립 타입 정의 이유는 위 모듈
 * docstring 참고(studio-heal-clone.ts의 선례를 따라 다른 브러시 도구의 픽셀 좌표 타입을 재사용하지 않음). */
export type LayerMaskPixelPoint = { x: number; y: number };

/** 브러시 한 스트로크(포인터다운→업 사이 누적된 전체 궤적)를 굽기 위한 입력. */
export type LayerMaskBrushStroke = {
  points: readonly LayerMaskPixelPoint[];
  radiusPx: number; // 자연 픽셀 반경(호출부가 표시px→자연px 환산해서 넘긴다, heal-clone 관례와 동일)
  hardness: number; // 0..1, 1=하드 엣지, 0=최대 페더(HEAL_CLONE_HARDNESS_RANGE와 동일 관례)
  strength: number; // 0..1, 스트로크 전체에 걸리는 불투명도(HEAL_CLONE_OPACITY_RANGE와 동일 관례)
  mode: LayerMaskPaintMode;
};

// ---------------------------------------------------------------------------
// (B) 브러시 파라미터 기본값·범위 — heal-clone(HEAL_CLONE_*)과 동일 관례(표시 px 기준,
// 자연 px 환산은 호출부 책임). 반경 상한만 넉넉히(마스크는 넓은 영역을 한 번에 쓸 때가 많다).
// ---------------------------------------------------------------------------

export const LAYER_MASK_BRUSH_RADIUS_RANGE = { min: 6, max: 240, step: 1 } as const;
export const LAYER_MASK_BRUSH_RADIUS_DEFAULT = 48;
export const LAYER_MASK_BRUSH_HARDNESS_RANGE = { min: 0, max: 1, step: 0.05 } as const;
export const LAYER_MASK_BRUSH_HARDNESS_DEFAULT = 0.6;
export const LAYER_MASK_BRUSH_STRENGTH_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;
export const LAYER_MASK_BRUSH_STRENGTH_DEFAULT = 1;

// ---------------------------------------------------------------------------
// (C) 브러시 스트로크 굽기 — 순수 벡터 스트로크(paintSelectionMaskSteps와 동일 스타일)
// ---------------------------------------------------------------------------

/**
 * 경도(hardness 0..1) → 실제 blur px. 반경에 비례한 페더를 쓴다(고정 px 페더는 작은 브러시를
 * 과하게 뭉개고 큰 브러시엔 안 보이므로) — rasterizeSelectionMask의 고정 featherPx와 달리 이
 * 모듈은 브러시 반경 자체가 사용자 조절 대상이라 상대 비율이 더 예측 가능하다. 순수.
 */
export function layerMaskFeatherPx(radiusPx: number, hardness: number): number {
  const r = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
  const h = Number.isFinite(hardness) ? Math.min(1, Math.max(0, hardness)) : 1;
  return r * (1 - h) * 0.6;
}

/**
 * 스트로크 하나를 ctx에 제자리로 굽는다 — 호출 전에 ctx에 "지금까지의 마스크"가 이미 그려져
 * 있다고 가정한다(bakeLayerMaskStroke가 그 순서를 보장). mode="reveal"은 source-over 흰색으로
 * 알파를 끌어올리고(반복 칠하면 Porter-Duff source-over 공식대로 1을 향해 점근), mode="conceal"은
 * destination-out으로 알파를 끌어내린다(0을 향해 점근) — 둘 다 페인트 통처럼 "덧칠하면 더
 * 진해지는" 브러시의 자연스러운 감쇠를 별도 로직 없이 합성 공식 자체에서 얻는다.
 * points.length===0 이거나 radiusPx<=0 이거나 strength<=0 이면 no-op(퇴화 스트로크 방어).
 * 점 1개(탭)는 같은 점에 lineTo 해 라운드 캡이 원(점 찍기)을 그리게 한다(paintSelectionMaskSteps
 * 의 브러시 분기와 동일 트릭). 끝나면 filter/합성 모드를 원복한다(관례).
 */
export function paintLayerMaskStroke(ctx: MaskCtx2DLike, stroke: LayerMaskBrushStroke): void {
  const radius = Number.isFinite(stroke.radiusPx) ? Math.max(0, stroke.radiusPx) : 0;
  const strength = Number.isFinite(stroke.strength) ? Math.min(1, Math.max(0, stroke.strength)) : 0;
  if (stroke.points.length === 0 || radius <= 0 || strength <= 0) return;

  const feather = layerMaskFeatherPx(radius, stroke.hardness);
  ctx.globalCompositeOperation = stroke.mode === "reveal" ? "source-over" : "destination-out";
  ctx.filter = feather > 0 ? `blur(${feather}px)` : "none";
  const rgba = `rgba(255,255,255,${strength})`;
  ctx.strokeStyle = rgba;
  ctx.fillStyle = rgba;
  ctx.lineWidth = Math.max(0.5, radius * 2);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  const first = stroke.points[0]!;
  ctx.moveTo(first.x, first.y);
  if (stroke.points.length === 1) {
    ctx.lineTo(first.x, first.y);
  } else {
    for (let i = 1; i < stroke.points.length; i += 1) {
      const p = stroke.points[i]!;
      ctx.lineTo(p.x, p.y);
    }
  }
  ctx.stroke();

  ctx.filter = "none";
  ctx.globalCompositeOperation = "source-over";
}

/**
 * existingMask(없으면 null="아직 마스크가 없는 상태") 위에 스트로크를 구워 새 마스크 캔버스를
 * 만든다. existingMask가 null이면 "전체 보임"(흰 알파255) 풀-마스크를 베이스로 새로 만든 뒤
 * 칠한다 — Photoshop이 마스크 없는 레이어에 처음 마스크 브러시를 대면 자동으로 흰 마스크를
 * 추가하는 관례와 동일(별도로 "마스크 추가" 버튼을 먼저 누르지 않아도 됨 — createLayerMaskCanvas
 * 는 그래도 명시적 추가/채우기 액션을 위해 별도로 남겨둔다). width/height는 el.src의 자연 해상도
 * (마스크와 같은 좌표계). 팩토리가 null이면(2D 컨텍스트 실패) null.
 */
export function bakeLayerMaskStroke(
  existingMask: MaskImageSource | null,
  width: number,
  height: number,
  stroke: LayerMaskBrushStroke,
  createCanvas: SelectionCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  const out = createCanvas(w, h);
  if (!out) return null;
  if (existingMask) {
    out.ctx.drawImage(existingMask, 0, 0);
  } else {
    out.ctx.fillStyle = "#ffffff";
    out.ctx.fillRect(0, 0, w, h);
  }
  paintLayerMaskStroke(out.ctx, stroke);
  return out.canvas;
}

// ---------------------------------------------------------------------------
// (D) 마스크 생명주기 — 즉시 실행(굽기) 액션. 전부 patchEl(el.id, { maskSrc: <결과> }) 한 번으로
// 커밋되어 히스토리 1건(⌘Z 1회)이 된다(호출부 책임 — 이 모듈은 순수 캔버스 결과만 만든다).
// ---------------------------------------------------------------------------

/**
 * 새 마스크 캔버스 생성 — "마스크 추가"(fill="reveal", 전체 보임) 또는 "숨기기 마스크 추가"
 * (fill="conceal", 전체 숨김 — Alt/Option+클릭 변형). conceal은 캔버스가 이미 완전 투명(alpha 0)
 * 으로 시작하므로 아무것도 그리지 않는다(no-op 최적화, rasterizeSelectionMask의 clearRect 관례와
 * 동일하게 "새 캔버스=이미 비어있음"을 그대로 활용).
 */
export function createLayerMaskCanvas(
  width: number,
  height: number,
  fill: LayerMaskPaintMode,
  createCanvas: SelectionCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createCanvas(w, h);
  if (!out) return null;
  if (fill === "reveal") {
    out.ctx.fillStyle = "#ffffff";
    out.ctx.fillRect(0, 0, w, h);
  }
  return out.canvas;
}

/**
 * 마스크 반전 — 알파를 제자리에서 뒤집은 새 캔버스(255-alpha). rasterizeSelectionMask의 invert
 * 단계와 동일한 트릭: 흰색 전체를 채운 캔버스에서 기존 마스크를 destination-out으로 파낸다
 * (파낸 만큼, 즉 기존에 불투명했던 만큼 투명해지고 — 그 반대도 성립). 왜 즉시 굽기인지는 모듈
 * docstring 참고.
 */
export function invertLayerMaskAlpha(
  mask: MaskImageSource,
  width: number,
  height: number,
  createCanvas: SelectionCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createCanvas(w, h);
  if (!out) return null;
  out.ctx.fillStyle = "#ffffff";
  out.ctx.fillRect(0, 0, w, h);
  out.ctx.globalCompositeOperation = "destination-out";
  out.ctx.drawImage(mask, 0, 0);
  out.ctx.globalCompositeOperation = "source-over";
  return out.canvas;
}

// ---------------------------------------------------------------------------
// (E) 최종 합성 — 렌더-타임(Konva/ClipMaskGroup)에는 쓰이지 않는다(그쪽은 clipBelow와 동일한
// Porter-Duff "source-in" Konva 합성을 재사용 — StudioPage.tsx 통합 문서 참고). 이 함수는
// Konva를 거치지 않는 경로(PSD/평탄화 내보내기, "마스크 적용해서 굽기" 같은 파괴적 편의 액션)
// 전용 — source(원본 el.src 이미지)+mask를 "destination-in"으로 합성해 최종 보이는 픽셀만
// 남긴 캔버스 하나를 만든다. applySelectionAdjustToCanvas의 delete 분기와 동일한 패턴.
// ---------------------------------------------------------------------------

export function compositeLayerMask(
  source: MaskImageSource,
  mask: MaskImageSource,
  width: number,
  height: number,
  createCanvas: SelectionCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const out = createCanvas(w, h);
  if (!out) return null;
  out.ctx.drawImage(source, 0, 0);
  out.ctx.globalCompositeOperation = "destination-in";
  out.ctx.drawImage(mask, 0, 0);
  out.ctx.globalCompositeOperation = "source-over";
  return out.canvas;
}
