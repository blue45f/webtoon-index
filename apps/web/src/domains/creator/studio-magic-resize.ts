/**
 * Studio Magic Resize — 페이지 규격(정방형/가로 썸네일/세로 스토리 등) 전환 시 요소를
 * 새 캔버스 크기에 맞춰 재배치·재스케일하는 순수 로직.
 *
 * 배경: 캔버스 폭(CANVAS_W=720)은 studio-assets.ts의 전역 고정 상수이며 StudioPage.tsx
 * 전반(150곳 이상)에서 그대로 참조된다 — 요소별 폭을 임의로 바꾸는 전면 리팩터는 이 기능의
 * 범위 밖이다. 그래서 v1의 프리셋(MAGIC_RESIZE_PRESETS)은 항상 폭을 CANVAS_W로 고정한 채
 * 높이만 비율에 맞게 바꾼다 — "가로 썸네일(16:9)"은 실제로 720×405로 재현된다(절대 해상도가
 * 아니라 종횡비 재현). 다만 아래 순수 함수들(computeMagicResize 등)은 폭이 함께 바뀌는
 * 입력도 수학적으로 올바르게 처리하도록 일반화해 두었다 — 향후 폭 가변화 시 그대로 재사용 가능.
 *
 * 두 가지 전략:
 * - "reposition"(기본, normalizedRepositionResize) — 각 요소의 중심점을 캔버스 대비 정규화
 *   비율로 보존해 새 위치로 옮긴다. 요소 자체 크기는 건드리지 않는다(찌그러짐 없음) — 폭이
 *   고정이고 높이만 바뀌는 v1 시나리오에서, 세로 위치가 새 높이 비율에 맞게 재배치된다.
 * - "scaleToFit"(scaleToFitResize) — 전체 구도를 균일 배율로 한 번에 축소/확대해 새 캔버스
 *   안에 반드시 들어맞힌다(레터박스 여백 발생 가능). 항상 안전한 폴백 — 요소가 새 캔버스
 *   밖으로 나가거나 겹치는 경우가 없다.
 *
 * 알려진 한계(문서화된 스코프 아웃, v1 미처리):
 * - BubbleEl.tailAnchorPoint(캔버스 절대 고정좌표)는 재배치되지 않는다 — 말풍선 자체는
 *   옮겨지지만 꼬리가 향하던 고정점은 그대로라 다음 커밋에서 각도가 어긋날 수 있다. tailHeight
 *   (꼬리 길이, 절대 px)도 scaleToFit 배율을 따라가지 않는다 — 같은 이유로 v1 스코프 아웃.
 * - animTimeline 키프레임(요소 위치를 시간축으로 보간하는 값)은 이 모듈이 모르는 별도
 *   구조라 리사이즈되지 않는다.
 * - 마스터 페이지 요소·사용자 가이드선(userGuides)은 이 함수의 입력이 아니므로 재배치되지
 *   않는다(호출 측이 페이지 elements만 넘긴다는 전제).
 *
 * (참고: draw.symmetry.centerX/centerY와 text/sticker의 중심점은 위 한계 목록에 없다 —
 * 아래 각 섹션에서 별도로 정확히 처리한다.)
 *
 * 무장(armed)/제스처 가로채기 도구가 아니다 — 클릭 한 번으로 결정적 계산 후 즉시
 * commit(nextElements, { canvasH })로 커밋되는 단발성 변환이라, disarmAllPixelTools 같은
 * 도구 해제 훅과는 무관하다.
 *
 * 전부 순수·결정적(랜덤 없음). DOM/Konva/React 의존 없음. 요소 타입은 El을 직접 import하지
 * 않는 duck-typed 인터페이스(studio-pages.ts의 PageElementLike 관례를 따름) — 단위 테스트와
 * StudioPage가 동일한 진짜 export를 공유한다.
 */

import { CANVAS_W } from "./studio-assets";

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export interface MagicResizeCanvasSize {
  width: number;
  height: number;
}

/**
 * El(StudioPage.tsx)의 여러 variant를 아우르는 최소 duck-type. 실제로는 아래처럼 요소마다
 * 기하 필드 의미가 다르다:
 * - image/bubble/frame/focusLines/speedLines: x,y,width,height 모두 존재(좌상단 기준).
 * - text: x,y,width는 있지만 height는 저장되지 않는다(폰트 크기로 유도).
 * - sticker: x,y,fontSize만 있고 width/height 자체가 없다(점 취급).
 * - draw(자유선/도형): x,y,width,height가 없고 points가 캔버스 절대좌표([x0,y0,x1,y1,…]).
 *   대칭 그리기로 만들어졌다면 symmetry.centerX/centerY도 points와 동일한 캔버스 절대좌표계다
 *   (StudioPage.tsx의 getSymmetricPoints가 매 렌더마다 이 축을 기준으로 미러 사본을 계산한다
 *   — 커밋된 요소에 영구히 남는 필드라 points만 옮기고 축을 안 옮기면 미러가 어긋난다).
 * - frame의 points(비정형 폴리곤)는 반대로 el.x/y 기준 로컬 오프셋 — 캔버스 절대좌표가 아니다.
 *   프레임 x/y를 옮기면 폴리곤은 자동으로 따라오므로 reposition 전략에선 points를 건드리지
 *   않는다(scaleToFit 전략은 배율만 곱해 로컬 오프셋 크기를 함께 줄인다).
 */
export interface MagicResizeElementLike {
  id: string;
  type?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  points?: unknown;
  fontSize?: unknown;
  /** draw 전용 — 대칭 그리기 축(캔버스 절대좌표) { type, centerX, centerY, radialCount }.
   *  centerX/centerY만 변환 대상이고, 다른 필드는 그대로 보존한다. */
  symmetry?: unknown;
}

export type MagicResizeStrategy = "reposition" | "scaleToFit";

export interface MagicResizeStrategyInfo {
  id: MagicResizeStrategy;
  label: string;
  hint: string;
}

export const MAGIC_RESIZE_STRATEGIES: MagicResizeStrategyInfo[] = [
  {
    id: "reposition",
    label: "재배치",
    hint: "요소 크기는 그대로 두고, 중심 위치만 새 캔버스 비율에 맞춰 옮깁니다. 찌그러짐 없이 구도만 다시 잡고 싶을 때.",
  },
  {
    id: "scaleToFit",
    label: "맞춤 축소",
    hint: "전체 구도를 비율 그대로 한 번에 축소·확대해 새 캔버스에 맞춥니다(남는 영역은 여백). 항상 안전한 기본값.",
  },
];

export const MAGIC_RESIZE_DEFAULT_STRATEGY: MagicResizeStrategy = "reposition";

export interface MagicResizePreset {
  id: string;
  label: string;
  hint: string;
  /** 종횡비 폭 비율(정수/소수 무관, aspectW:aspectH). */
  aspectW: number;
  /** 종횡비 높이 비율. */
  aspectH: number;
}

/**
 * 대표 페이지 규격 프리셋 5종. 폭은 항상 CANVAS_W로 고정되고(presetCanvasSize) 높이만
 * 종횡비에 맞게 계산된다 — 그래서 여기 순서/라벨은 "이 종횡비를 어디에 쓰는가"를 기준으로
 * 잡았다(실제 업로드 규격 자체가 아니라 캔버스 안에서의 구도 비율 가이드).
 */
export const MAGIC_RESIZE_PRESETS: MagicResizePreset[] = [
  { id: "square", label: "정방형", hint: "인스타그램 피드·프로필 카드에 맞는 1:1 정방형.", aspectW: 1, aspectH: 1 },
  {
    id: "landscape-thumb",
    label: "가로 썸네일",
    hint: "유튜브·플랫폼 썸네일에 맞는 16:9 가로.",
    aspectW: 16,
    aspectH: 9,
  },
  {
    id: "portrait-story",
    label: "세로 스토리",
    hint: "인스타그램·카카오 스토리에 맞는 9:16 세로.",
    aspectW: 9,
    aspectH: 16,
  },
  { id: "tall-cut", label: "세로 컷", hint: "웹툰 스크롤 한 컷에 맞는 3:4 세로.", aspectW: 3, aspectH: 4 },
  {
    id: "landscape-card",
    label: "가로 카드",
    hint: "공유 카드·OG 이미지에 맞는 1.91:1 가로.",
    aspectW: 1.91,
    aspectH: 1,
  },
];

/** id로 프리셋 조회(없으면 undefined). */
export function findMagicResizePreset(id: string): MagicResizePreset | undefined {
  return MAGIC_RESIZE_PRESETS.find((p) => p.id === id);
}

/**
 * 프리셋 종횡비를 baseWidth(기본 CANVAS_W) 기준 실제 캔버스 크기로 환산.
 * width = round(baseWidth), height = round(width * aspectH / aspectW).
 * aspectW<=0(잘못된 프리셋 데이터 방어) 이면 1로 취급해 0-나눗셈을 피한다.
 * baseWidth<=0 이면 최소 1로 클램프.
 */
export function presetCanvasSize(preset: MagicResizePreset, baseWidth: number = CANVAS_W): MagicResizeCanvasSize {
  const width = Math.max(1, Math.round(baseWidth));
  const aspectW = preset.aspectW > 0 ? preset.aspectW : 1;
  const height = Math.max(1, Math.round((width * preset.aspectH) / aspectW));
  return { width, height };
}

// ---------------------------------------------------------------------------
// 내부 헬퍼
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 유효한 캔버스 크기인지(둘 다 양수) — 아니면 모든 계산이 항등(identity)으로 폴백한다. */
function isValidSize(size: MagicResizeCanvasSize): boolean {
  return size.width > 0 && size.height > 0;
}

interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** points([x0,y0,x1,y1,…]) 바운딩 박스. 좌표 쌍이 하나도 없으면 원점 0크기. */
function pointsBoundingBox(points: number[]): ElementBounds {
  if (points.length < 2) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = points[0];
  let maxX = points[0];
  let minY = points[1];
  let maxY = points[1];
  for (let i = 0; i < points.length - 1; i += 2) {
    const px = points[i];
    const py = points[i + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** draw 요소인지(points가 캔버스 절대좌표인 부류) — frame은 type이 다르므로 자동 제외된다. */
function isAbsolutePointsElement(el: MagicResizeElementLike): boolean {
  return el.type === "draw" && Array.isArray(el.points) && el.points.length >= 2;
}

/** text 높이 유도 배수 — StudioPage.tsx의 elBounds()와 동일한 근사(줄 간격 포함 1줄 높이). */
const TEXT_HEIGHT_FROM_FONT_SIZE = 1.4;

/**
 * 요소의 유효 바운딩 박스(중심점 계산용). draw는 points 바운딩 박스, 그 외는 x/y/width/height
 * 기반이되 text/sticker는 StudioPage.tsx의 elBounds() 관례를 그대로 따른다 — width/height
 * 필드가 없는 자리를 무조건 0으로 취급하면(=sticker를 폭 0의 점, text를 높이 0의 선분으로
 * 다루면) 앱의 다른 기능(정렬·마퀴 선택·말풍선 꼬리 타깃팅)이 계산하는 "진짜 중심"과 어긋나,
 * 리사이즈 후 위치가 fontSize/2(sticker) 또는 fontSize*0.7(text) 만큼 체계적으로 치우친다:
 * - sticker: width=height=fontSize(정사각형 박스로 취급, elBounds와 동일).
 * - text: height가 저장되지 않으므로 fontSize*1.4로 유도(elBounds와 동일), width는 저장된 값.
 * - 그 외(image/bubble/frame/focusLines/speedLines 등)는 x/y/width/height를 그대로 쓰고,
 *   필드가 아예 없는 경우에만 0으로 폴백한다.
 */
function elementBounds(el: MagicResizeElementLike): ElementBounds {
  if (isAbsolutePointsElement(el)) {
    return pointsBoundingBox(el.points as number[]);
  }
  const x = isFiniteNumber(el.x) ? el.x : 0;
  const y = isFiniteNumber(el.y) ? el.y : 0;
  if (el.type === "sticker") {
    const size = isFiniteNumber(el.fontSize) ? el.fontSize : 0;
    return { x, y, width: size, height: size };
  }
  const width = isFiniteNumber(el.width) ? el.width : 0;
  const height = isFiniteNumber(el.height)
    ? el.height
    : el.type === "text" && isFiniteNumber(el.fontSize)
      ? el.fontSize * TEXT_HEIGHT_FROM_FONT_SIZE
      : 0;
  return { x, y, width, height };
}

// ---------------------------------------------------------------------------
// 전략 1: scaleToFit — 균일 배율 + 레터박스(항상 안전한 폴백)
// ---------------------------------------------------------------------------

function scaleValue(v: number, axisScale: number, offset: number): number {
  return v * axisScale + offset;
}

/**
 * symmetry.centerX/centerY(캔버스 절대좌표)를 points/x·y와 동일한 규칙으로 변환한다.
 * centerX/centerY 외 필드(type, radialCount)는 그대로 보존. symmetry가 없거나 객체가
 * 아니면(방어적) 원본을 그대로 반환.
 */
function transformSymmetry(symmetry: unknown, mapX: (x: number) => number, mapY: (y: number) => number): unknown {
  if (typeof symmetry !== "object" || symmetry === null) return symmetry;
  const sym = symmetry as Record<string, unknown>;
  const next: Record<string, unknown> = { ...sym };
  if (isFiniteNumber(sym.centerX)) next.centerX = mapX(sym.centerX);
  if (isFiniteNumber(sym.centerY)) next.centerY = mapY(sym.centerY);
  return next;
}

function scaleOneElement<E extends MagicResizeElementLike>(el: E, scale: number, offsetX: number, offsetY: number): E {
  const next: MagicResizeElementLike = { ...el };
  if (isFiniteNumber(el.x)) next.x = scaleValue(el.x, scale, offsetX);
  if (isFiniteNumber(el.y)) next.y = scaleValue(el.y, scale, offsetY);
  if (isFiniteNumber(el.width)) next.width = el.width * scale;
  if (isFiniteNumber(el.height)) next.height = el.height * scale;
  if (isFiniteNumber(el.fontSize)) next.fontSize = el.fontSize * scale;
  if (Array.isArray(el.points)) {
    const pts = el.points as number[];
    if (isAbsolutePointsElement(el)) {
      // draw: 캔버스 절대좌표 — 배율 + 오프셋을 축별로 적용.
      next.points = pts.map((v, i) => (i % 2 === 0 ? scaleValue(v, scale, offsetX) : scaleValue(v, scale, offsetY)));
    } else {
      // frame 등 로컬 오프셋 폴리곤 — x/y가 이미 재배치되므로 크기만 배율(오프셋 없이).
      next.points = pts.map((v) => v * scale);
    }
  }
  if (el.symmetry !== undefined) {
    // draw의 대칭 축도 points와 같은 캔버스 절대좌표계 — 동일한 배율+오프셋으로 함께 옮긴다.
    next.symmetry = transformSymmetry(
      el.symmetry,
      (x) => scaleValue(x, scale, offsetX),
      (y) => scaleValue(y, scale, offsetY)
    );
  }
  return next as E;
}

/**
 * 전체 구도를 균일 배율로 축소/확대해 새 캔버스 안에 딱 맞춘다(letterbox). 배율은
 * min(to.width/from.width, to.height/from.height) — 어느 축도 새 캔버스를 벗어나지 않는다.
 * 중앙 정렬(남는 여백은 좌우 또는 상하로 균등 분배).
 *
 * from 또는 to의 폭/높이가 0 이하이면 계산이 무의미(0-나눗셈/역배율)하므로 원본을 그대로
 * 복제해 반환한다(항등, 부작용 없음).
 */
export function scaleToFitResize<E extends MagicResizeElementLike>(
  elements: readonly E[],
  from: MagicResizeCanvasSize,
  to: MagicResizeCanvasSize
): E[] {
  if (!isValidSize(from) || !isValidSize(to)) return elements.slice();
  const scale = Math.min(to.width / from.width, to.height / from.height);
  const offsetX = (to.width - from.width * scale) / 2;
  const offsetY = (to.height - from.height * scale) / 2;
  return elements.map((el) => scaleOneElement(el, scale, offsetX, offsetY));
}

// ---------------------------------------------------------------------------
// 전략 2: reposition — 정규화된 중심점 재배치(기본, 크기 불변)
// ---------------------------------------------------------------------------

function repositionOneElement<E extends MagicResizeElementLike>(
  el: E,
  from: MagicResizeCanvasSize,
  to: MagicResizeCanvasSize
): E {
  const bounds = elementBounds(el);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const nextCenterX = (centerX / from.width) * to.width;
  const nextCenterY = (centerY / from.height) * to.height;
  const dx = nextCenterX - centerX;
  const dy = nextCenterY - centerY;

  const next: MagicResizeElementLike = { ...el };
  if (isAbsolutePointsElement(el)) {
    const pts = el.points as number[];
    next.points = pts.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
  } else {
    if (isFiniteNumber(el.x)) next.x = el.x + dx;
    if (isFiniteNumber(el.y)) next.y = el.y + dy;
    // frame의 points는 x/y 기준 로컬 오프셋이라 위 x/y 이동만으로 자동 추종 — 별도 처리 불필요.
  }
  if (el.symmetry !== undefined) {
    // draw의 대칭 축(캔버스 절대좌표)도 이 요소의 points/x·y와 같은 dx,dy로 평행이동해야
    // 미러 사본이 원본과 같이 움직인다(그대로 두면 미러가 옛 축을 기준으로 어긋나게 그려진다).
    next.symmetry = transformSymmetry(
      el.symmetry,
      (x) => x + dx,
      (y) => y + dy
    );
  }
  return next as E;
}

/**
 * 각 요소의 중심점을 캔버스 대비 정규화 비율(0..1)로 보존해 새 캔버스 크기에 맞는 위치로
 * 옮긴다. 요소 자체의 크기(width/height/fontSize)는 전혀 바꾸지 않는다 — 찌그러짐이 없다.
 *
 * v1의 전형적 입력(폭은 고정, 높이만 변경)에서는 가로 이동이 0이 되고 세로 위치만 새 비율에
 * 맞춰 재배치된다(예: 세로 중앙에 있던 요소는 새 높이에서도 세로 중앙에 남는다).
 *
 * from 또는 to의 폭/높이가 0 이하이면 정규화 비율 자체가 무의미(0-나눗셈 또는 모든 중심점이
 * 한 점으로 붕괴)하므로 scaleToFitResize와 동일하게 원본을 그대로 복제해 반환한다(항등).
 */
export function normalizedRepositionResize<E extends MagicResizeElementLike>(
  elements: readonly E[],
  from: MagicResizeCanvasSize,
  to: MagicResizeCanvasSize
): E[] {
  if (!isValidSize(from) || !isValidSize(to)) return elements.slice();
  return elements.map((el) => repositionOneElement(el, from, to));
}

// ---------------------------------------------------------------------------
// 진입점
// ---------------------------------------------------------------------------

/**
 * 전략에 따라 scaleToFitResize / normalizedRepositionResize로 위임하는 단일 진입점.
 * strategy 생략 시 MAGIC_RESIZE_DEFAULT_STRATEGY("reposition").
 */
export function computeMagicResize<E extends MagicResizeElementLike>(
  elements: readonly E[],
  from: MagicResizeCanvasSize,
  to: MagicResizeCanvasSize,
  strategy: MagicResizeStrategy = MAGIC_RESIZE_DEFAULT_STRATEGY
): E[] {
  return strategy === "scaleToFit"
    ? scaleToFitResize(elements, from, to)
    : normalizedRepositionResize(elements, from, to);
}
