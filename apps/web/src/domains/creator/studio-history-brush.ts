/**
 * Studio History Brush — Photoshop 히스토리 브러시(History Brush) 대응 순수 코어.
 *
 * studio-heal-clone.ts 와 같은 계층 구성을 쓰되, 오프셋 개념이 없어 한 계층(A)이 통째로 더
 * 단순해진다:
 *   (A) 소스 해석 — 히스토리 스냅샷(과거 페이지 배열)에서 "지금 선택된 이미지와 같은 id"를 찾아
 *       그 src 를 꺼낸다. heal-clone 의 Alt+클릭 소스 앵커 지정과 동일하게 "지정 시점에 1회
 *       해석해 결과값만 기억한다"는 패턴 — 이후 dab 계산은 이 해석 결과(src 문자열)만 쓴다.
 *   (B) 기하 — 목적지 궤적(정규화 SelPoint)을 디바이스 px 로 환산한다. heal-clone 의
 *       planHealCloneDabs 와 달리 소스 오프셋이 없다 — "그 시점 이미지의 같은 좌표"를 그대로
 *       읽으면 되므로 dab 은 좌표 하나(x,y)로 충분하다(heal-clone 의 HealCloneDab 은 src/dest
 *       4개 필드가 필요했다).
 *   (C) 픽셀 알고리즘 — StudioImageDataLike 입출력만 다루는 순수 함수(캔버스 무관, 유닛 테스트
 *       가능). heal 모드의 로컬 평균 톤매칭이 없다 — "그 시점 픽셀 그대로"를 복원하는 것이
 *       기능의 본질이라 색을 이동시키면 오히려 목적에 어긋난다(항상 heal-clone 의 "clone" 모드에
 *       해당하는 리터럴 복사만 한다).
 *   (D) 캔버스 팩토리 orchestration — applySelectionAdjustToCanvas/bakeHealCloneStrokeToCanvas 와
 *       동일하게 DOM 은 호출자(StudioPage)가 주입한다. heal-clone 은 소스/목적지가 항상 "같은
 *       이미지"라 프레임 하나만 그리면 됐지만, 여기는 소스(과거 시점 이미지)와 목적지(지금
 *       이미지)가 서로 다른 두 이미지일 수 있어 캔버스 2장을 각각 다른 원본으로 채운다. 자연
 *       해상도가 서로 다를 수 있다는 점(예: 그 사이 크롭이 있었던 경우)은 4-인자
 *       drawImage(image, 0, 0, w, h)로 목적지 크기에 맞춰 늘려 그려 흡수한다 — 완벽한 정합은
 *       아니지만(§ 알려진 한계는 통합 설계 문서 참고) 크래시 없이 항상 그럴듯한 결과를 낸다.
 *
 * 좌표 규약: heal-clone/studio-selection-tools 와 동일한 정규화 SelPoint(요소 비회전 로컬 박스
 * 0..1) 공간. flip(좌우/상하 반전 표시) 처리도 flipNormalizedPoint 동일 관례 — 현재 선택된
 * 요소의 flip 상태가 "화면(반전 표시) 기준 점 → 원본 비반전 픽셀 좌표" 변환에 그대로 쓰인다(과거
 * 시점에 flip 상태가 달랐을 가능성은 추적하지 않는다 — 통합 설계 문서의 알려진 한계 참고).
 */
import { flipNormalizedPoint } from "./studio-magic-wand";

import type { StudioImageDataLike } from "./studio-filters";
import type { MaskCanvasLike, MaskCtx2DLike, MaskImageSource, SelPoint } from "./studio-selection-tools";

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼(모듈 로컬 — studio-heal-clone.ts/studio-node-edit.ts 등 형제 모듈과 동일하게
// 각자 작게 둔다, 공유 유틸로 뽑지 않는다).
// ---------------------------------------------------------------------------

/** 0..1 클램프(비유한은 0). */
function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

// 표시 px 기준 — HEAL_CLONE_RADIUS_RANGE 와 동일 관례(브러시 계열 전 도구가 같은 감각을 공유하게).
export const HISTORY_BRUSH_RADIUS_RANGE = { min: 6, max: 160, step: 1 } as const;
export const HISTORY_BRUSH_RADIUS_DEFAULT = 32;
export const HISTORY_BRUSH_HARDNESS_RANGE = { min: 0, max: 1, step: 0.05 } as const; // 1=하드 엣지, 0=최대 페더
export const HISTORY_BRUSH_HARDNESS_DEFAULT = 0.55;
export const HISTORY_BRUSH_OPACITY_RANGE = { min: 0.05, max: 1, step: 0.05 } as const;
export const HISTORY_BRUSH_OPACITY_DEFAULT = 1;

export type HistoryBrushSettings = { radiusPx: number; hardness: number; opacity: number };

// ---------------------------------------------------------------------------
// (A) 소스 해석 — 히스토리 스냅샷에서 "같은 id 이미지"를 찾아 src 를 꺼낸다
// ---------------------------------------------------------------------------

/**
 * studio-history-labels.ts 의 HistoryElementLike/HistoryPageLike 와 같은 "최소 구조 인터페이스"
 * 관례 — 이 파일은 pagesHistory(StudioPage 의 PageState[][])를 구조적으로만 필요로 한다(Konva/DOM
 * 은 물론 StudioPage 의 El/PageState 구체 타입도 몰라야 한다). src 를 요구한다는 점이
 * studio-history-labels 의 HistoryElementLike 와 다른 유일한 차이 — 그쪽은 diff 라벨링에 src 가
 * 필요 없어 뺐고, 이쪽은 그 자체가 목적이라 필요하다. 두 인터페이스는 서로 무관하게 각자
 * 파일에서 독립적으로 선언되며, 실제로는 둘 다 같은 PageState[][] 배열이 구조적으로 만족한다.
 */
export interface HistoryBrushElementLike {
  id: string;
  type?: unknown; // "image" 인지만 확인한다.
  src?: unknown; // 이미지 데이터 URL. string 이 아니면 사용하지 않는다(방어적).
}

export interface HistoryBrushPageLike {
  id: string;
  elements: readonly HistoryBrushElementLike[];
}

/** 히스토리 한 칸 = 그 시점 전체 페이지 배열(studio-history-labels 의 HistorySnapshot 과 같은 개념). */
export type HistoryBrushSnapshot = readonly HistoryBrushPageLike[];

export type HistoryBrushSourceResult =
  | { ok: true; src: string }
  | { ok: false; reason: "page-not-found" | "element-not-found" | "not-image" };

/**
 * 히스토리 스냅샷 1개에서 "지금 편집 중인 이미지 요소"와 같은 id 를 가진 이미지를 찾아 그 src 를
 * 꺼낸다. 실패 이유를 구분해 반환해 UI가 "그 시점엔 이 레이어가 없어요" 처럼 정확한 안내를 할 수
 * 있게 한다. heal-clone 의 Alt+클릭 소스 앵커 지정과 동일하게 "지정 시점에 1회 해석, 이후엔 그
 * 결과 src 문자열만 쓴다" 패턴이다 — 호출자(StudioPage)는 반환된 src 를 즉시 상태로 저장해야
 * 한다(이 함수 자체는 아무것도 기억하지 않는 순수 함수).
 *
 * masterEditMode 를 위한 별도 분기가 없다 — 문서 마스터 요소는 애초에 pagesHistory 에 들어가지
 * 않으므로, 마스터 편집 중 선택된 요소의 id 는 어떤 히스토리 스냅샷에서도 "element-not-found"로
 * 자연스럽게 판정된다(통합 설계 문서 참고).
 */
export function resolveHistoryBrushSource(
  snapshot: HistoryBrushSnapshot,
  pageId: string,
  elementId: string
): HistoryBrushSourceResult {
  const page = snapshot.find((p) => p.id === pageId);
  if (!page) return { ok: false, reason: "page-not-found" };
  const el = page.elements.find((e) => e.id === elementId);
  if (!el) return { ok: false, reason: "element-not-found" };
  if (el.type !== "image" || typeof el.src !== "string") return { ok: false, reason: "not-image" };
  return { ok: true, src: el.src };
}

/**
 * 히스토리 목록 전체에 대해 "지금 지정 가능한지"를 한 번에 계산한다 — StudioHistoryPanel 이 매
 * 행(row)마다 개별 호출 없이 index 로 바로 조회할 배열 하나를 받을 수 있게 한다
 * (studio-history-labels 의 buildHistoryTimeline 과 동일하게 "배열 전체를 한 번에 변환해 패널에
 * 넘긴다"는 관례). 반환 배열의 인덱스는 history/HistoryTimelineEntry.index 와 같은 좌표계다.
 */
export function computeHistoryBrushAvailability(
  history: readonly HistoryBrushSnapshot[],
  pageId: string,
  elementId: string
): boolean[] {
  return history.map((snapshot) => resolveHistoryBrushSource(snapshot, pageId, elementId).ok);
}

// ---------------------------------------------------------------------------
// (B) 기하 — 정규화 목적지 궤적 → 디바이스 px 도장 목록(오프셋 없음)
// ---------------------------------------------------------------------------

/** 도장 1개 — 좌표계 하나(x,y)만 있으면 된다. 소스(과거 시점 이미지)와 목적지(지금 이미지) 양쪽을
 * 정확히 같은 좌표로 읽고 쓴다 — heal-clone 의 HealCloneDab(srcX/srcY/destX/destY 4필드)과 달리
 * 오프셋을 표현할 필요가 없다. */
export type HistoryBrushDab = { x: number; y: number };

/**
 * 정규화 목적지 궤적 + 이미지 크기 → 디바이스(자연) px 도장 목록. flip 규약은 heal-clone/
 * planHealCloneDabs 와 동일: 화면(반전 표시) 기준 점을 원본 비반전 픽셀 좌표로 되돌린다. 소스와
 * 목적지가 정확히 같은 점이므로 flipNormalizedPoint 를 한 번만 적용하면 된다(heal-clone 은 dest/
 * src 각각에 적용해야 했다).
 */
export function planHistoryBrushDabs(
  destPointsNorm: readonly SelPoint[],
  imageW: number,
  imageH: number,
  opts?: { flipX?: boolean; flipY?: boolean }
): HistoryBrushDab[] {
  const w = Number.isFinite(imageW) && imageW > 0 ? imageW : 0;
  const h = Number.isFinite(imageH) && imageH > 0 ? imageH : 0;
  if (w <= 0 || h <= 0) return [];
  const flipX = opts?.flipX ?? false;
  const flipY = opts?.flipY ?? false;
  const dabs: HistoryBrushDab[] = [];
  for (const norm of destPointsNorm) {
    const raw = flipNormalizedPoint(norm, flipX, flipY);
    const x = raw.x * w;
    const y = raw.y * h;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    dabs.push({ x, y });
  }
  return dabs;
}

// ---------------------------------------------------------------------------
// (C) 픽셀 알고리즘 — StudioImageDataLike 순수 입출력
// ---------------------------------------------------------------------------

/**
 * 도장 1개 적용 — current(제자리 변형)에 historySrc(읽기 전용, 스트로크 시작 시점에 고정된 "그
 * 시점" 냉동 버퍼)의 같은 좌표를 원형으로 복사한다. hardness<1이면 가장자리로 갈수록 알파가
 * 선형으로 줄어든다(edgeStart=radius*hardness 부터 radius까지 1→0) — heal-clone 의 stamp 함수와
 * 동일한 페더 수식. heal-clone 과 달리 색 이동(톤매칭)이 없다 — "그 시점 픽셀을 있는 그대로"
 * 되돌리는 것이 기능의 본질이라 heal 모드에 해당하는 분기 자체가 없다(항상 리터럴 복사).
 * historySrc/current 의 폭·높이가 서로 다를 수 있다(호출자가 자연 해상도가 다른 두 이미지를
 * 넘겼을 가능성 — bakeHistoryBrushStrokeToCanvas 의 헤더 주석 참고) — 각 버퍼 경계를 각각
 * 클램프해 어느 한쪽이 좁아도 크래시 없이 겹치는 부분만 그려진다.
 */
export function stampHistoryBrushDab(
  historySrc: StudioImageDataLike,
  current: StudioImageDataLike,
  dab: HistoryBrushDab,
  radiusPx: number,
  hardness: number,
  opacity: number
): void {
  const R = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const op = clampUnit(opacity);
  if (R <= 0 || op <= 0) return;
  if (!Number.isFinite(dab.x) || !Number.isFinite(dab.y)) return;
  const hard = clampUnit(hardness);

  const edgeStart = R * hard;
  const span = Math.max(1e-6, R - edgeStart);
  const rCeil = Math.ceil(R);
  const sw = historySrc.width;
  const sh = historySrc.height;
  const dw = current.width;
  const dh = current.height;

  for (let oy = -rCeil; oy <= rCeil; oy += 1) {
    for (let ox = -rCeil; ox <= rCeil; ox += 1) {
      const dist = Math.hypot(ox, oy);
      if (dist > R) continue;
      const alpha = dist <= edgeStart ? op : op * (1 - (dist - edgeStart) / span);
      if (alpha <= 0) continue;

      // 오프셋이 없으므로 소스/목적지 좌표가 같다 — 각 버퍼 경계는 독립적으로 클램프한다
      // (historySrc/current 자연 해상도가 다를 수 있어서, 한쪽만 벗어나도 그 dab 픽셀은 건너뛴다).
      const px = Math.round(dab.x + ox);
      const py = Math.round(dab.y + oy);
      if (px < 0 || py < 0 || px >= sw || py >= sh) continue;
      if (px >= dw || py >= dh) continue;

      const sIdx = (py * sw + px) * 4;
      const dIdx = (py * dw + px) * 4;
      const r = historySrc.data[sIdx]!;
      const g = historySrc.data[sIdx + 1]!;
      const b = historySrc.data[sIdx + 2]!;
      const a = historySrc.data[sIdx + 3]!; // 알파도 시프트 없이 그대로 — 과거 시점이 투명이었다면 다시 투명해진다.

      current.data[dIdx] = current.data[dIdx]! * (1 - alpha) + r * alpha;
      current.data[dIdx + 1] = current.data[dIdx + 1]! * (1 - alpha) + g * alpha;
      current.data[dIdx + 2] = current.data[dIdx + 2]! * (1 - alpha) + b * alpha;
      current.data[dIdx + 3] = current.data[dIdx + 3]! * (1 - alpha) + a * alpha;
    }
  }
}

/** 스트로크 전체(도장 목록) 적용 — stampHistoryBrushDab 을 순서대로 호출한다(뒤 도장이 앞을 덮는다). */
export function applyHistoryBrushDabs(
  historySrc: StudioImageDataLike,
  current: StudioImageDataLike,
  dabs: readonly HistoryBrushDab[],
  radiusPx: number,
  hardness: number,
  opacity: number
): void {
  for (const dab of dabs) {
    stampHistoryBrushDab(historySrc, current, dab, radiusPx, hardness, opacity);
  }
}

// ---------------------------------------------------------------------------
// (D) 캔버스 팩토리 orchestration — bakeHealCloneStrokeToCanvas 와 동일 관례
// ---------------------------------------------------------------------------

/**
 * studio-selection-tools.ts 의 MaskCtx2DLike 를 확장 — heal-clone 의 HealCloneCtx2DLike 와
 * 동일하게 도장 패치를 읽고 쓰려면 get/putImageData 가 필요하다. 추가로 drawImage 의 4-인자
 * (스케일 그리기) 오버로드를 더한다 — MaskCtx2DLike 는 2-인자(dx,dy, 자연 크기 그대로)만
 * 선언한다. 히스토리 소스 이미지가 지금 이미지와 자연 해상도가 다를 수 있어(예: 그 사이 크롭이
 * 있었던 경우) 항상 목적지 크기(w,h)로 늘려/줄여 그려 정규화 좌표 매핑이 계속 들어맞게 한다.
 * `createPixelEditCanvas`(StudioPage.tsx)는 **수정 없이 그대로** 이 자리에 넘길 수 있다 —
 * 진짜 CanvasRenderingContext2D.drawImage 는 2/4/9-인자 오버로드를 전부 지원하므로 구조적으로
 * 만족한다(heal-clone/studio-puppet-warp 와 동일한 메서드 바이베리언스 관례, 컴파일 검증됨).
 */
export type HistoryBrushCtx2DLike = MaskCtx2DLike & {
  getImageData(sx: number, sy: number, sw: number, sh: number): StudioImageDataLike;
  putImageData(imageData: StudioImageDataLike, dx: number, dy: number): void;
  drawImage(image: MaskImageSource, dx: number, dy: number, dw: number, dh: number): void;
};

/** 오프스크린 캔버스 팩토리 — DOM 의존부를 호출자(StudioPage)가 주입한다. */
export type HistoryBrushCanvasFactory = (
  width: number,
  height: number
) => { canvas: MaskCanvasLike & MaskImageSource; ctx: HistoryBrushCtx2DLike } | null;

/**
 * 스트로크 전체를 굽는다. heal-clone 과 달리 소스가 하나가 아니라 둘이다 — historySource(히스토리
 * 패널에서 지정한 "그 시점" 이미지)와 currentSource(지금 선택된 이미지). 결과 캔버스는 항상
 * currentSource 기준 크기(width,height, 보통 target.naturalWidth/Height)로 만든다 — 굽기 결과가
 * "지금 레이어의 새 src"가 되어야 하므로 목적지 크기가 기준이다. dabs 가 비었으면 null(구울 게
 * 없음 — 호출자는 patchEl 을 생략해야 한다는 신호) — 이 경우 캔버스를 아예 만들지 않는다.
 */
export function bakeHistoryBrushStrokeToCanvas(
  historySource: MaskImageSource,
  currentSource: MaskImageSource,
  width: number,
  height: number,
  dabs: readonly HistoryBrushDab[],
  brush: HistoryBrushSettings,
  createCanvas: HistoryBrushCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  if (dabs.length === 0) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  // frozen — "그 시점" 소스를 한 번 그린 뒤 스트로크 내내 다시 건드리지 않는다(heal-clone 의
  // frozen 과 동일한 이유 — 여러 dab이 서로의 결과가 아니라 항상 스트로크 시작 시점의 히스토리
  // 픽셀을 읽어야 한다). 4-인자 drawImage 로 목적지 크기(w,h)에 맞춰 그린다 — historySource 의
  // 자연 해상도가 currentSource 와 달라도 늘려/줄여 정규화 좌표가 계속 들어맞게 한다.
  const frozen = createCanvas(w, h);
  if (!frozen) return null;
  frozen.ctx.drawImage(historySource, 0, 0, w, h);

  // work — 지금 이미지를 한 번 그린 뒤 도장이 누적되며 실제로 변형되는 결과 버퍼.
  const work = createCanvas(w, h);
  if (!work) return null;
  work.ctx.drawImage(currentSource, 0, 0, w, h);

  const frozenData = frozen.ctx.getImageData(0, 0, w, h);
  const workData = work.ctx.getImageData(0, 0, w, h);

  applyHistoryBrushDabs(frozenData, workData, dabs, brush.radiusPx, brush.hardness, brush.opacity);

  work.ctx.putImageData(workData, 0, 0);
  return work.canvas;
}
