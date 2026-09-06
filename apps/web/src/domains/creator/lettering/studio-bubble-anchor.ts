/**
 * Studio Bubble Anchor — 말풍선 꼬리 자동 부착 순수 코어.
 *
 * 기존 말풍선 꼬리(tailDirection/tailXRatio/tailHeight)는 StudioPage.tsx 의 노란 손잡이
 * 드래그(~9301-9365의 onDragMove, ~9316-9357)로만 수동 조작된다 — 말풍선이나 목표물이
 * 옮겨지면 꼬리는 그 자리에 멈춰 있어 다시 손으로 맞춰야 한다.
 *
 * 이 모듈은 그 손잡이 드래그 핸들러가 하던 "손잡이 위치 → (tailDirection, tailXRatio,
 * tailHeight)" 계산을 그대로 재사용해, 손잡이 대신 "겨냥할 캔버스 좌표 점"을 입력으로 받는
 * 순수 함수로 다시 노출한다. 노란 손잡이로 직접 끌었을 때와 100% 동일한 결과를 내도록
 * 설계했다(같은 임계값·같은 우선순위·같은 반올림) — 자동 부착을 껐다 켜도 결과가 요동치지
 * 않는다.
 *
 * 좌표계: bubble.x/y 는 캔버스(페이지) 좌표, bubble.width/height 는 비회전 로컬 크기,
 * bubble.rotation 은 도(°) 단위 시계방향(Konva 관례, Group 은 offsetX/Y 없이 (0,0) 기준
 * 회전 — StudioPage.tsx 의 bubble Group 과 동일). targetPoint 는 캔버스 좌표의 점 하나다.
 * 내부에서 targetPoint 를 말풍선 로컬(비회전) 좌표로 역회전시켜 손잡이 드래그와 동일한
 * 기준으로 계산한다 — 회전된 말풍선에 자동 부착해도 손잡이로 끈 것과 같은 결과가 나온다.
 *
 * 대상(target)의 회전은 고려하지 않는다 — elBounds() 를 비롯해 이 파일 전역의 정렬·분배·
 * 패널 포함 판정이 전부 대상의 회전을 무시하는 근사와 일관된 선택이다(대상은 "점 하나"만
 * 필요하므로 회전 여부가 그 점의 정의에 영향이 없기도 하다 — 아래 "대상 중심점" 참고).
 *
 * DOM/Konva 의존성 없음.
 */
import type { BubbleTailDirection } from "./studio-bubble-path";

/** "자기 자신"(부착시키는 말풍선)의 기하 — BubbleEl 의 필드명과 1:1로 맞춰 StudioPage 가
 *  BubbleEl 을 그대로 넘길 수 있게 한다(변환 어댑터 불필요). */
export interface AnchorBubbleShape {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 도(°), 기본 0. */
  rotation?: number;
  /** 화자 방향 미러 — BubbleEl.tail 과 동일 의미, 기본 "left". */
  tail?: "left" | "right" | "none";
}

/** "대상"의 바운즈 — elBounds() 의 반환 shape 과 1:1로 맞춰 StudioPage 가 elBounds(el) 을
 *  그대로 넘길 수 있게 한다(변환 어댑터 불필요). */
export interface AnchorTargetBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BubbleAnchorSpec {
  tailAnchorId?: string;
  tailAnchorPoint?: { x: number; y: number };
}

export interface BubbleAnchorTailResult {
  tailDirection: BubbleTailDirection;
  tailXRatio: number; // 반올림 2자리, [0.15, 0.85] 클램프 — 손잡이 드래그와 동일
  tailHeight: number; // 정수 반올림, [8, 150] 클램프 — 손잡이 드래그와 동일
}

/** 손잡이 드래그(StudioPage.tsx ~9329,9334,9339,9344)와 동일한 클램프 범위. */
export const BUBBLE_ANCHOR_RATIO_RANGE = { min: 0.15, max: 0.85 } as const;
/** 손잡이 드래그(~9330,9335,9340,9345)와 동일한 클램프 범위. */
export const BUBBLE_ANCHOR_LENGTH_RANGE = { min: 8, max: 150 } as const;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const isFinite2 = (a: number, b: number) => Number.isFinite(a) && Number.isFinite(b);

/**
 * 말풍선이 targetPoint(캔버스 좌표)를 겨냥하도록 tailDirection/tailXRatio/tailHeight 를
 * 계산한다. 말풍선 bounds 가 비정상(width/height<=0, 비유한)이거나 targetPoint 가 비유한이면
 * null(호출부는 이번 커밋에서 건드리지 말고 다음 기회에 재시도 — resolvePerspectiveRay 와
 * 동일한 "아직 계산 불가" 관례).
 */
export function computeBubbleAnchorTail(
  bubble: AnchorBubbleShape,
  targetPoint: { x: number; y: number }
): BubbleAnchorTailResult | null {
  const { x, y, width: w, height: h } = bubble;
  const rotationDeg = bubble.rotation ?? 0;
  if (!isFinite2(x, y) || !isFinite2(w, h) || !Number.isFinite(rotationDeg)) return null;
  if (!isFinite2(targetPoint.x, targetPoint.y)) return null;
  if (w <= 0 || h <= 0) return null;

  // 1) 캔버스 좌표 → 말풍선 로컬(비회전) 좌표. Konva Group 이 (0,0) 기준으로 회전하므로
  //    x/y 를 먼저 빼고 -rotation 만큼 역회전한다(손잡이가 Konva 내부적으로 겪는 변환과 동일).
  const relX = targetPoint.x - x;
  const relY = targetPoint.y - y;
  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localX = relX * cos - relY * sin;
  const localY = relX * sin + relY * cos;

  // 2) 네 변까지 거리 — StudioPage.tsx ~9316-9320 과 동일 공식.
  const dTop = Math.abs(localY);
  const dBot = Math.abs(localY - h);
  const dLeft = Math.abs(localX);
  const dRight = Math.abs(localX - w);
  const minDist = Math.min(dTop, dBot, dLeft, dRight);

  // 동률 우선순위도 원본과 동일하게 bottom > top > left > right 순으로 검사한다(~9326-9345).
  let direction: BubbleTailDirection;
  let ratio: number;
  let length: number;
  if (minDist === dBot) {
    direction = "bottom";
    ratio = clamp(localX / w, BUBBLE_ANCHOR_RATIO_RANGE.min, BUBBLE_ANCHOR_RATIO_RANGE.max);
    length = clamp(localY - h, BUBBLE_ANCHOR_LENGTH_RANGE.min, BUBBLE_ANCHOR_LENGTH_RANGE.max);
  } else if (minDist === dTop) {
    direction = "top";
    ratio = clamp(localX / w, BUBBLE_ANCHOR_RATIO_RANGE.min, BUBBLE_ANCHOR_RATIO_RANGE.max);
    length = clamp(-localY, BUBBLE_ANCHOR_LENGTH_RANGE.min, BUBBLE_ANCHOR_LENGTH_RANGE.max);
  } else if (minDist === dLeft) {
    direction = "left";
    ratio = clamp(localY / h, BUBBLE_ANCHOR_RATIO_RANGE.min, BUBBLE_ANCHOR_RATIO_RANGE.max);
    length = clamp(-localX, BUBBLE_ANCHOR_LENGTH_RANGE.min, BUBBLE_ANCHOR_LENGTH_RANGE.max);
  } else {
    direction = "right";
    ratio = clamp(localY / h, BUBBLE_ANCHOR_RATIO_RANGE.min, BUBBLE_ANCHOR_RATIO_RANGE.max);
    length = clamp(localX - w, BUBBLE_ANCHOR_LENGTH_RANGE.min, BUBBLE_ANCHOR_LENGTH_RANGE.max);
  }

  // 3) 화자 방향 미러(el.tail) — 손잡이(~9348-9350)와 동일 규약, bottom/top 에만 영향.
  if ((bubble.tail ?? "left") === "right" && (direction === "bottom" || direction === "top")) {
    ratio = 1 - ratio;
  }

  return {
    tailDirection: direction,
    tailXRatio: Math.round(ratio * 100) / 100,
    tailHeight: Math.round(length),
  };
}

/**
 * BubbleAnchorSpec 에서 실제로 겨냥할 캔버스 좌표 점을 뽑는다.
 * - tailAnchorId 가 있으면 getTargetBounds(id) 의 중심점(대상을 "요소" 단위로 취급 — 회전은
 *   무시, elBounds() 와 동일 근사). getTargetBounds 가 null 을 주면(요소가 사라졌거나 자기
 *   자신을 가리키는 등 호출부가 무효로 판단한 경우) null.
 * - tailAnchorPoint 가 있으면 그대로.
 * - 둘 다 없으면 null(부착 안 됨).
 * - 우선순위: tailAnchorId 가 tailAnchorPoint 보다 우선한다(패널이 상호배타를 보장하지만
 *   방어적으로 — 두 필드가 동시에 남아있는 저장본을 만나도 안전).
 */
export function resolveAnchorTargetPoint(
  spec: BubbleAnchorSpec,
  getTargetBounds: (id: string) => AnchorTargetBounds | null
): { x: number; y: number } | null {
  if (spec.tailAnchorId) {
    const b = getTargetBounds(spec.tailAnchorId);
    if (!b) return null;
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  if (spec.tailAnchorPoint) return spec.tailAnchorPoint;
  return null;
}

/** resolveAnchorTargetPoint + computeBubbleAnchorTail 을 한 번에 — 프리뷰/단발 호출용
 *  편의 함수(주의: StudioPage 의 commit-pass 는 이걸 쓰지 않는다 — "대상 삭제됨"과
 *  "말풍선 bounds 일시적 비정상"을 구분해야 하므로 두 함수를 따로 호출한다). */
export function computeAnchoredBubbleTailPatch(
  bubble: AnchorBubbleShape & BubbleAnchorSpec,
  getTargetBounds: (id: string) => AnchorTargetBounds | null
): BubbleAnchorTailResult | null {
  const point = resolveAnchorTargetPoint(bubble, getTargetBounds);
  if (!point) return null;
  return computeBubbleAnchorTail(bubble, point);
}
