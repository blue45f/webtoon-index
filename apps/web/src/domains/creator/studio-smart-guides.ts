/**
 * Studio Smart Guides — PPT/피그마급 "요소 간" 스마트 가이드 + 균등 간격 스냅 엔진.
 * 기존 스냅(캔버스 가장자리·그리드·수동 가이드·들어있는 패널)은 StudioPage 의
 * onStageDragMove 가 라인 목록으로 처리한다. 이 모듈은 거기에 없던 두 가지를 더한다:
 *   1) computeSmartSnap      — 드래그 중 요소 bbox vs 다른 요소 bbox 들의
 *      엣지/센터 정렬 후보(수직·수평, 기본 임계 6px)와
 *      균등 간격 후보(양옆/위아래 이웃과 동일 gap)를 O(n) 으로 찾아
 *      축별 최적 스냅 오프셋(delta)을 돌려준다.
 *   2) buildSmartGuideOverlay — 스냅 확정 위치 기준으로 그릴 정렬 선분(요소들을
 *      잇는 구간만)과 균등 간격 배지 목록을 돌려준다.
 * Konva/DOM 무의존 순수 계산 — 호출부(StudioPage)와 단위 테스트가 공유한다.
 * 성능: 요소 수백 개·60fps 가정. 모든 패스는 단일 O(n) 스캔이고,
 * 두 축 모두 완전 일치(dist≈0)를 찾으면 조기 종료, 오버레이 선분 수집은
 * 선분당 소스 상한(MAX_SEGMENT_SOURCES)으로 조기 종료한다.
 * 좌표계: 호출부가 주는 좌표계(레이어 좌표)를 그대로 쓴다. 화면 픽셀 기준 임계를
 * 원하면 threshold/epsilon 을 effScale 로 나눠 넘기면 된다.
 */

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

/** 축정렬 바운딩 박스(회전이 반영된 client rect 권장). */
export interface GuideBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 스냅 후보 종류 — edge/center = 정렬, spacing = 균등 간격. */
export type SmartSnapKind = "edge" | "center" | "spacing";

/** 한 축의 스냅 후보 — delta 만큼 옮기면 스냅이 성립한다. */
export interface AxisSnapCandidate {
  /** 스냅 성립까지의 이동량(부호 있음, 0이면 이미 정렬됨). */
  delta: number;
  /** |delta| — 그리드·캔버스 라인 등 다른 스냅 소스와의 우선순위 비교용. */
  dist: number;
  kind: SmartSnapKind;
}

/** 드래그 프레임당 스냅 계산 결과 — 축별 최적 후보(없으면 null). */
export interface SmartSnapResult {
  x: AxisSnapCandidate | null;
  y: AxisSnapCandidate | null;
}

/** 그릴 정렬 가이드 선분. v=수직선(pos=x, from~to=y 구간), h=수평선(pos=y, from~to=x 구간). */
export interface GuideSegment {
  axis: "v" | "h";
  pos: number;
  from: number;
  to: number;
  /** center = 센터끼리만 정렬, edge = 엣지가 하나라도 관여. */
  kind: "edge" | "center";
}

/** 균등 간격 배지 — 이동 요소 양쪽 gap 이 같아졌음을 표시한다. */
export interface SpacingIndicator {
  /** x = 가로 간격(양옆 이웃), y = 세로 간격(위아래 이웃). */
  axis: "x" | "y";
  /** 동일해진 간격 값(좌표 단위, 라벨 표시용). */
  gap: number;
  /** 간격 선분을 그릴 교차축 좌표(세 박스 공통 겹침 구간의 중앙). */
  at: number;
  /** 두 간격 구간 [이웃A~이동요소, 이동요소~이웃B] (본축 좌표). */
  spans: Array<{ from: number; to: number }>;
}

/** 오버레이 렌더에 필요한 전부 — 정렬 선분 + 균등 간격 배지. */
export interface SmartGuideOverlay {
  segments: GuideSegment[];
  spacings: SpacingIndicator[];
}

/**
 * Non-destructive smart-guide preview.
 *
 * `actualBox` is the element's untouched drag position. `previewBox` is a ghost-only target made
 * from the suggested deltas, and `overlay` contains the lines/spacing badges for that target.
 * Consumers may therefore show alignment candidates while positional snapping is disabled.
 */
export interface SmartGuideOverlayPreview {
  readonly actualBox: GuideBox;
  readonly previewBox: GuideBox;
  readonly suggestedDelta: {
    readonly x: number;
    readonly y: number;
  };
  readonly hasSuggestion: boolean;
  readonly overlay: SmartGuideOverlay;
}

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** 기본 스냅 임계(px). 화면 픽셀 기준을 원하면 SMART_SNAP_THRESHOLD/effScale 로 넘긴다. */
export const SMART_SNAP_THRESHOLD = 6;

/** 오버레이 판정 허용 오차 — 스냅 확정 후 "정확히 맞음"으로 볼 최대 편차(px). */
export const SMART_GUIDE_EPSILON = 0.5;

/** 빈 오버레이 — 드래그 종료·스냅 꺼짐 시 상태 초기화용 공용 참조. */
export const EMPTY_SMART_GUIDE_OVERLAY: SmartGuideOverlay = { segments: [], spacings: [] };

/** 가이드 선분 하나에 합칠 정렬 상대 최대 수 — 수집 조기 종료 상한. */
const MAX_SEGMENT_SOURCES = 12;

/** 이 거리 이하면 "완전 일치"로 보고 더 나은 후보 탐색을 조기 종료한다. */
const EXACT_EPS = 1e-6;

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

/** 한 축의 세 기준선 [시작 엣지, 센터, 끝 엣지]. */
function lines3(start: number, size: number): [number, number, number] {
  return [start, start + size / 2, start + size];
}

/** 좌표·크기가 유한하고 크기가 음수가 아닌 정상 박스인지. */
function isValidBox(box: GuideBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= 0 &&
    box.height >= 0
  );
}

/** 본축(axis)의 [시작, 끝] 구간. */
function mainSpan(box: GuideBox, axis: "x" | "y"): [number, number] {
  return axis === "x" ? [box.x, box.x + box.width] : [box.y, box.y + box.height];
}

/** 교차축의 [시작, 끝] 구간. */
function crossSpan(box: GuideBox, axis: "x" | "y"): [number, number] {
  return axis === "x" ? [box.y, box.y + box.height] : [box.x, box.x + box.width];
}

/** 두 구간이 실제로 겹치는지(접점만 닿는 0 겹침은 제외). */
function spansOverlap(a: [number, number], b: [number, number]): boolean {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > 0;
}

// ---------------------------------------------------------------------------
// 1) 스냅 후보 계산
// ---------------------------------------------------------------------------

/**
 * 이동 요소와 교차축으로 겹치는("같은 줄") 좌/우(상/하) 최근접 이웃을 O(n) 으로 찾는다.
 * tolerance: 이웃으로 인정할 본축 침범 허용치 — 드래그 중 살짝 겹친 상태에서도
 * 균등 간격 후보를 낼 수 있게 한다. 이동 요소를 크게 덮는 배경 등은 자연히 제외된다.
 */
function nearestNeighbors(
  moving: GuideBox,
  others: readonly GuideBox[],
  axis: "x" | "y",
  tolerance: number
): { before: GuideBox | null; after: GuideBox | null } {
  const [movingStart, movingEnd] = mainSpan(moving, axis);
  const movingCross = crossSpan(moving, axis);
  let before: GuideBox | null = null;
  let beforeEdge = -Infinity;
  let after: GuideBox | null = null;
  let afterEdge = Infinity;
  for (const other of others) {
    if (other.id === moving.id || !isValidBox(other)) continue;
    if (!spansOverlap(crossSpan(other, axis), movingCross)) continue;
    const [start, end] = mainSpan(other, axis);
    if (end <= movingStart + tolerance) {
      // 왼쪽(위) 이웃: 끝변이 가장 가까운(큰) 것
      if (end > beforeEdge) {
        before = other;
        beforeEdge = end;
      }
    } else if (start >= movingEnd - tolerance && start < afterEdge) {
      // 오른쪽(아래) 이웃: 시작변이 가장 가까운(작은) 것
      after = other;
      afterEdge = start;
    }
  }
  return { before, after };
}

/**
 * 균등 간격 후보 — 양옆(위아래) 최근접 이웃 사이에서 왼쪽 gap == 오른쪽 gap 이 되는
 * 정중앙 위치까지의 이동량. 들어갈 공간이 없거나(threshold 밖 포함) 이웃이 한쪽뿐이면 null.
 */
function spacingCandidate(
  moving: GuideBox,
  others: readonly GuideBox[],
  axis: "x" | "y",
  threshold: number
): AxisSnapCandidate | null {
  const { before, after } = nearestNeighbors(moving, others, axis, threshold);
  if (!before || !after) return null;
  const size = axis === "x" ? moving.width : moving.height;
  const beforeEnd = mainSpan(before, axis)[1];
  const afterStart = mainSpan(after, axis)[0];
  const gap = (afterStart - beforeEnd - size) / 2; // 균등 배치 시 한쪽 간격
  if (gap < 0) return null; // 두 이웃 사이에 들어갈 공간이 없다
  const target = beforeEnd + gap;
  const delta = target - mainSpan(moving, axis)[0];
  const dist = Math.abs(delta);
  return dist <= threshold ? { delta, dist, kind: "spacing" } : null;
}

/**
 * Point / stroke-endpoint object snap (CSP-class placement).
 *
 * Treats the pen tip as a zero-size box and snaps each axis independently to the nearest edge or
 * center line of other element bboxes. Spacing candidates are intentionally omitted: a freehand
 * tip has no width, so equal-gap placement is undefined.
 */
export interface PointObjectSnapResult {
  readonly x: number;
  readonly y: number;
  readonly snappedX: boolean;
  readonly snappedY: boolean;
  readonly guideX: number | null;
  readonly guideY: number | null;
  readonly kindX: "edge" | "center" | null;
  readonly kindY: "edge" | "center" | null;
}

/**
 * Whether stroke/shape placement should consult object edges for this sample.
 *
 * - Eraser / directional rulers (perspective, isometric, advanced) stay out of the way.
 * - Freehand uses latch-based edge following (`planFreehandObjectSnapPoint`) when snap or
 *   alignment guides are on — mutating samples is gated separately so guides can preview
 *   without bending the stroke when only guide display is enabled.
 * - Shape/line endpoints may snap because they are explicit placement gestures.
 */
export function shouldApplyStrokeObjectSnap(input: {
  readonly snapEnabled: boolean;
  /** When true, freehand/shape may consult guides for overlay even if pixel-snap is off. */
  readonly showAlignmentGuides?: boolean;
  readonly mode?: string;
  readonly kind?: string;
  readonly directionalRulerActive?: boolean;
  /** 0-based index of the sample about to be written (0 = stroke origin). */
  readonly sampleIndex: number;
}): boolean {
  if (input.mode === "eraser") return false;
  if (input.directionalRulerActive) return false;
  // sampleIndex is reserved for callers that branch UI hints or endpoint phases.
  void input.sampleIndex;
  // Object-edge consultation is independent from pure pixel-grid snap: either master switch
  // (snap master or alignment-guide visibility) is enough to plan a guide result.
  return input.snapEnabled || input.showAlignmentGuides === true;
}

/**
 * Whether the planned object-snap result should rewrite stroke coordinates.
 * Freehand and shapes both mutate only when the snap master is on; guide-only mode previews.
 */
export function shouldMutateStrokeWithObjectSnap(input: {
  readonly snapEnabled: boolean;
}): boolean {
  return input.snapEnabled === true;
}

/**
 * Per-axis sticky latch for freehand object snap (CSP-class "draw along edge").
 * Holding a guide while the tip stays inside the hold radius prevents zigzag hopping between
 * nearby object edges during continuous freehand sampling.
 */
export interface FreehandObjectSnapLatch {
  readonly guideX: number | null;
  readonly guideY: number | null;
}

export const EMPTY_FREEHAND_OBJECT_SNAP_LATCH: FreehandObjectSnapLatch = Object.freeze({
  guideX: null,
  guideY: null,
});

/** Release radius = capture threshold × this factor (must be ≥ 1). */
export const FREEHAND_OBJECT_SNAP_HOLD_FACTOR = 1.75;

export interface FreehandObjectSnapPlanInput {
  readonly x: number;
  readonly y: number;
  readonly others: readonly GuideBox[];
  readonly latch: FreehandObjectSnapLatch;
  readonly threshold?: number;
  readonly holdFactor?: number;
}

export interface FreehandObjectSnapPlanResult extends PointObjectSnapResult {
  readonly latch: FreehandObjectSnapLatch;
}

function resolveFreehandObjectSnapAxis(
  raw: number,
  latchedGuide: number | null,
  nearestGuide: number | null,
  nearestKind: "edge" | "center" | null,
  captureThreshold: number,
  holdThreshold: number
): {
  value: number;
  guide: number | null;
  kind: "edge" | "center" | null;
  snapped: boolean;
  nextLatch: number | null;
} {
  if (latchedGuide !== null && Number.isFinite(latchedGuide)) {
    // Stick to the latched guide while the raw tip is still within the hold radius — even when
    // another object edge is closer. That is the zigzag kill switch.
    if (Math.abs(raw - latchedGuide) <= holdThreshold) {
      const kind =
        nearestGuide !== null && Math.abs(nearestGuide - latchedGuide) <= EXACT_EPS
          ? nearestKind
          : "edge";
      return {
        value: latchedGuide,
        guide: latchedGuide,
        kind,
        snapped: true,
        nextLatch: latchedGuide,
      };
    }
  }

  // Fresh capture only inside the tighter capture threshold (not the hold radius).
  if (
    nearestGuide !== null
    && Number.isFinite(nearestGuide)
    && Math.abs(raw - nearestGuide) <= captureThreshold
  ) {
    return {
      value: nearestGuide,
      guide: nearestGuide,
      kind: nearestKind,
      snapped: true,
      nextLatch: nearestGuide,
    };
  }

  return {
    value: raw,
    guide: null,
    kind: null,
    snapped: false,
    nextLatch: null,
  };
}

/**
 * Freehand tip snap with per-axis latch: acquire within `threshold`, hold until
 * `threshold * holdFactor` pull-away, never hop guides while latched.
 */
export function planFreehandObjectSnapPoint(
  input: FreehandObjectSnapPlanInput
): FreehandObjectSnapPlanResult {
  const threshold = input.threshold ?? SMART_SNAP_THRESHOLD;
  const holdFactor = Math.max(1, input.holdFactor ?? FREEHAND_OBJECT_SNAP_HOLD_FACTOR);
  const holdThreshold = threshold * holdFactor;
  const empty: FreehandObjectSnapPlanResult = {
    x: input.x,
    y: input.y,
    snappedX: false,
    snappedY: false,
    guideX: null,
    guideY: null,
    kindX: null,
    kindY: null,
    latch: EMPTY_FREEHAND_OBJECT_SNAP_LATCH,
  };
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y) || !(threshold > 0)) {
    return empty;
  }

  // Search within the hold radius so we can re-detect kind while latched; capture still uses
  // the tighter threshold inside resolveFreehandObjectSnapAxis.
  const nearest = snapPointToObjectGuides(input.x, input.y, input.others, {
    threshold: holdThreshold,
  });
  const axisX = resolveFreehandObjectSnapAxis(
    input.x,
    input.latch.guideX,
    nearest.guideX,
    nearest.kindX,
    threshold,
    holdThreshold
  );
  const axisY = resolveFreehandObjectSnapAxis(
    input.y,
    input.latch.guideY,
    nearest.guideY,
    nearest.kindY,
    threshold,
    holdThreshold
  );
  const nextLatch: FreehandObjectSnapLatch =
    axisX.nextLatch === null && axisY.nextLatch === null
      ? EMPTY_FREEHAND_OBJECT_SNAP_LATCH
      : {
          guideX: axisX.nextLatch,
          guideY: axisY.nextLatch,
        };

  return {
    x: axisX.value,
    y: axisY.value,
    snappedX: axisX.snapped,
    snappedY: axisY.snapped,
    guideX: axisX.guide,
    guideY: axisY.guide,
    kindX: axisX.kind,
    kindY: axisY.kind,
    latch: nextLatch,
  };
}

/** Snap a document-space point to neighboring element edge/center guides. */
export function snapPointToObjectGuides(
  x: number,
  y: number,
  others: readonly GuideBox[],
  options: { threshold?: number } = {}
): PointObjectSnapResult {
  const threshold = options.threshold ?? SMART_SNAP_THRESHOLD;
  const empty: PointObjectSnapResult = {
    x,
    y,
    snappedX: false,
    snappedY: false,
    guideX: null,
    guideY: null,
    kindX: null,
    kindY: null,
  };
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(threshold > 0)) return empty;

  let bestXDist = Infinity;
  let bestYDist = Infinity;
  let bestX: number | null = null;
  let bestY: number | null = null;
  let kindX: "edge" | "center" | null = null;
  let kindY: "edge" | "center" | null = null;

  for (const other of others) {
    if (!isValidBox(other)) continue;
    const otherX = lines3(other.x, other.width);
    const otherY = lines3(other.y, other.height);
    for (let oi = 0; oi < 3; oi += 1) {
      const lineKind: "edge" | "center" = oi === 1 ? "center" : "edge";
      const dx = otherX[oi]! - x;
      const adx = Math.abs(dx);
      if (adx <= threshold && adx < bestXDist) {
        bestXDist = adx;
        bestX = otherX[oi]!;
        kindX = lineKind;
      }
      const dy = otherY[oi]! - y;
      const ady = Math.abs(dy);
      if (ady <= threshold && ady < bestYDist) {
        bestYDist = ady;
        bestY = otherY[oi]!;
        kindY = lineKind;
      }
    }
    if (bestXDist <= EXACT_EPS && bestYDist <= EXACT_EPS) break;
  }

  const snappedX = bestX !== null;
  const snappedY = bestY !== null;
  return {
    x: snappedX ? bestX! : x,
    y: snappedY ? bestY! : y,
    snappedX,
    snappedY,
    guideX: snappedX ? bestX : null,
    guideY: snappedY ? bestY : null,
    kindX: snappedX ? kindX : null,
    kindY: snappedY ? kindY : null,
  };
}

/**
 * Build the alignment overlay for a snapped stroke tip (no spacing badges).
 * Segments span from the tip to the matched object edges so artists see the lock.
 */
export function buildPointObjectSnapOverlay(
  x: number,
  y: number,
  others: readonly GuideBox[],
  snap: PointObjectSnapResult,
  options: { epsilon?: number } = {}
): SmartGuideOverlay {
  if (!snap.snappedX && !snap.snappedY) return EMPTY_SMART_GUIDE_OVERLAY;
  const epsilon = options.epsilon ?? SMART_GUIDE_EPSILON;
  const pointBox: GuideBox = { id: "__stroke-tip__", x, y, width: 0, height: 0 };
  return buildSmartGuideOverlay(pointBox, others, { epsilon });
}

/**
 * 드래그 중 스냅 오프셋 계산 — 축별로 (엣지/센터 정렬 ∪ 균등 간격) 최근접 후보를 돌려준다.
 * 반환된 delta 를 요소 위치에 더하면 스냅이 성립한다. 후보가 임계 밖이면 축별 null.
 * 호출부는 dist 로 기존 라인 스냅(그리드·캔버스)과 우선순위를 비교하면 된다.
 */
export function computeSmartSnap(
  moving: GuideBox,
  others: readonly GuideBox[],
  options: { threshold?: number } = {}
): SmartSnapResult {
  const threshold = options.threshold ?? SMART_SNAP_THRESHOLD;
  if (!isValidBox(moving) || !(threshold > 0)) return { x: null, y: null };

  const movingX = lines3(moving.x, moving.width);
  const movingY = lines3(moving.y, moving.height);
  // 최단 거리는 별도 숫자로 추적 — 비교가 싸고, 자기 참조 가드의 좁히기 문제도 피한다.
  let bestX: AxisSnapCandidate | null = null;
  let bestY: AxisSnapCandidate | null = null;
  let bestXDist = Infinity;
  let bestYDist = Infinity;

  // ── 엣지/센터 정렬 후보: O(n), 요소당 3×3 기준선 쌍 비교 ──
  for (const other of others) {
    if (other.id === moving.id || !isValidBox(other)) continue;
    const otherX = lines3(other.x, other.width);
    const otherY = lines3(other.y, other.height);
    for (let oi = 0; oi < 3; oi++) {
      for (let mi = 0; mi < 3; mi++) {
        const kind: SmartSnapKind = oi === 1 && mi === 1 ? "center" : "edge";
        const dx = otherX[oi] - movingX[mi];
        const adx = Math.abs(dx);
        if (adx <= threshold && adx < bestXDist) {
          bestXDist = adx;
          bestX = { delta: dx, dist: adx, kind };
        }
        const dy = otherY[oi] - movingY[mi];
        const ady = Math.abs(dy);
        if (ady <= threshold && ady < bestYDist) {
          bestYDist = ady;
          bestY = { delta: dy, dist: ady, kind };
        }
      }
    }
    // 조기 종료: 두 축 모두 완전 일치면 더 좋은 후보는 없다.
    if (bestXDist <= EXACT_EPS && bestYDist <= EXACT_EPS) break;
  }

  // ── 균등 간격 후보: 더 가까우면 정렬 후보를 대체 ──
  const spacingX = spacingCandidate(moving, others, "x", threshold);
  if (spacingX && spacingX.dist < bestXDist) bestX = spacingX;
  const spacingY = spacingCandidate(moving, others, "y", threshold);
  if (spacingY && spacingY.dist < bestYDist) bestY = spacingY;

  return { x: bestX, y: bestY };
}

// ---------------------------------------------------------------------------
// 2) 오버레이(가이드 선분 + 간격 배지) 구성
// ---------------------------------------------------------------------------

/** 한 방향(v/h)의 정렬 선분 수집 — 이동 요소의 3개 기준선별로 맞은 상대를 병합한다. */
function collectAlignSegments(
  moved: GuideBox,
  others: readonly GuideBox[],
  axis: "v" | "h",
  epsilon: number
): GuideSegment[] {
  const movedLines = axis === "v" ? lines3(moved.x, moved.width) : lines3(moved.y, moved.height);
  const movedCross = axis === "v" ? ([moved.y, moved.y + moved.height] as const) : ([moved.x, moved.x + moved.width] as const);
  type Acc = { pos: number; count: number; min: number; max: number; centerOnly: boolean };
  const accs: (Acc | null)[] = [null, null, null];

  for (const other of others) {
    if (other.id === moved.id || !isValidBox(other)) continue;
    const otherLines = axis === "v" ? lines3(other.x, other.width) : lines3(other.y, other.height);
    const crossStart = axis === "v" ? other.y : other.x;
    const crossEnd = axis === "v" ? other.y + other.height : other.x + other.width;
    for (let mi = 0; mi < 3; mi++) {
      let acc = accs[mi];
      if (acc && acc.count >= MAX_SEGMENT_SOURCES) continue; // 선분당 소스 상한(조기 종료)
      for (let oi = 0; oi < 3; oi++) {
        if (Math.abs(otherLines[oi] - movedLines[mi]) > epsilon) continue;
        if (!acc) {
          acc = { pos: movedLines[mi], count: 0, min: movedCross[0], max: movedCross[1], centerOnly: true };
          accs[mi] = acc;
        }
        acc.count += 1;
        acc.min = Math.min(acc.min, crossStart);
        acc.max = Math.max(acc.max, crossEnd);
        if (mi !== 1 || oi !== 1) acc.centerOnly = false;
        break; // 같은 상대의 기준선 여러 개가 동시에 맞아도 한 번만 집계
      }
    }
    if (accs.every((a) => a !== null && a.count >= MAX_SEGMENT_SOURCES)) break; // 전 선분 포화 시 조기 종료
  }

  // 같은 위치의 선분 병합(0 크기 요소는 시작=센터=끝이 겹친다) 후 확정.
  const segments: GuideSegment[] = [];
  for (const acc of accs) {
    if (!acc) continue;
    const existing = segments.find((s) => Math.abs(s.pos - acc.pos) <= epsilon);
    if (existing) {
      existing.from = Math.min(existing.from, acc.min);
      existing.to = Math.max(existing.to, acc.max);
      if (!acc.centerOnly) existing.kind = "edge";
    } else {
      segments.push({ axis, pos: acc.pos, from: acc.min, to: acc.max, kind: acc.centerOnly ? "center" : "edge" });
    }
  }
  return segments;
}

/** 한 축의 균등 간격 배지 — 확정 위치에서 양쪽 gap 이 (epsilon 내로) 같을 때만 만든다. */
function buildSpacingIndicator(
  moved: GuideBox,
  others: readonly GuideBox[],
  axis: "x" | "y",
  epsilon: number
): SpacingIndicator | null {
  const { before, after } = nearestNeighbors(moved, others, axis, epsilon);
  if (!before || !after) return null;
  const [movedStart, movedEnd] = mainSpan(moved, axis);
  const beforeEnd = mainSpan(before, axis)[1];
  const afterStart = mainSpan(after, axis)[0];
  const gapBefore = movedStart - beforeEnd;
  const gapAfter = afterStart - movedEnd;
  if (gapBefore < 0 || gapAfter < 0) return null;
  if (Math.abs(gapBefore - gapAfter) > epsilon) return null;

  // 간격 선분을 그릴 교차축 위치: 세 박스가 공통으로 겹치는 구간의 중앙(없으면 이동 요소 중앙).
  const [movedCrossStart, movedCrossEnd] = crossSpan(moved, axis);
  const beforeCross = crossSpan(before, axis);
  const afterCross = crossSpan(after, axis);
  const lo = Math.max(movedCrossStart, beforeCross[0], afterCross[0]);
  const hi = Math.min(movedCrossEnd, beforeCross[1], afterCross[1]);
  const at = lo < hi ? (lo + hi) / 2 : (movedCrossStart + movedCrossEnd) / 2;

  return {
    axis,
    gap: (gapBefore + gapAfter) / 2,
    at,
    spans: [
      { from: beforeEnd, to: movedStart },
      { from: movedEnd, to: afterStart },
    ],
  };
}

/**
 * 스냅 확정 위치(moved) 기준으로 그릴 오버레이를 만든다.
 *   - 정렬 선분: 이동 요소의 기준선과 (epsilon 내로) 맞은 다른 요소들을 잇는 구간.
 *     그리드·캔버스 스냅으로 우연히 요소와 정렬된 경우에도 그대로 드러난다(PPT 동작).
 *   - 균등 간격 배지: 양쪽 gap 이 같아진 축에 간격 구간 두 개 + gap 값.
 * 아무것도 맞지 않으면 공용 빈 오버레이(EMPTY_SMART_GUIDE_OVERLAY)를 돌려준다.
 */
export function buildSmartGuideOverlay(
  moved: GuideBox,
  others: readonly GuideBox[],
  options: { epsilon?: number } = {}
): SmartGuideOverlay {
  const epsilon = options.epsilon ?? SMART_GUIDE_EPSILON;
  if (!isValidBox(moved) || !(epsilon >= 0)) return EMPTY_SMART_GUIDE_OVERLAY;

  const segments = [
    ...collectAlignSegments(moved, others, "v", epsilon),
    ...collectAlignSegments(moved, others, "h", epsilon),
  ];
  const spacings: SpacingIndicator[] = [];
  const spacingX = buildSpacingIndicator(moved, others, "x", epsilon);
  if (spacingX) spacings.push(spacingX);
  const spacingY = buildSpacingIndicator(moved, others, "y", epsilon);
  if (spacingY) spacings.push(spacingY);

  return segments.length === 0 && spacings.length === 0 ? EMPTY_SMART_GUIDE_OVERLAY : { segments, spacings };
}

function validPreviewCandidate(
  value: AxisSnapCandidate | null
): value is AxisSnapCandidate {
  return value !== null
    && Number.isFinite(value.delta)
    && Number.isFinite(value.dist)
    && value.dist >= 0
    && Math.abs(value.dist - Math.abs(value.delta)) <= EXACT_EPS
    && (
      value.kind === "edge"
      || value.kind === "center"
      || value.kind === "spacing"
    );
}

/**
 * Builds guide visuals at a suggested alignment target without applying that target to the
 * element. This is the bridge for `정렬선 표시 ON + 스냅 OFF`: callers keep rendering/storing the
 * actual box, and may draw `previewBox` as a ghost plus `overlay` as candidate lines.
 *
 * The legacy `computeSmartSnap` and `buildSmartGuideOverlay` contracts are untouched. Passing no
 * candidates returns a detached copy of the actual box and the shared empty overlay. Invalid
 * boxes fail closed as null; malformed candidates are ignored axis-by-axis.
 */
export function buildSmartGuideOverlayPreview(
  actual: GuideBox,
  others: readonly GuideBox[],
  suggested: SmartSnapResult,
  options: { epsilon?: number } = {}
): SmartGuideOverlayPreview | null {
  if (!isValidBox(actual)) return null;
  const xCandidate = validPreviewCandidate(suggested.x) ? suggested.x : null;
  const yCandidate = validPreviewCandidate(suggested.y) ? suggested.y : null;
  const deltaX = xCandidate?.delta ?? 0;
  const deltaY = yCandidate?.delta ?? 0;
  const actualBox = { ...actual };
  const previewBox = {
    ...actual,
    x: actual.x + deltaX,
    y: actual.y + deltaY,
  };
  const hasSuggestion = xCandidate !== null || yCandidate !== null;
  return {
    actualBox,
    previewBox,
    suggestedDelta: { x: deltaX, y: deltaY },
    hasSuggestion,
    overlay: hasSuggestion
      ? buildSmartGuideOverlay(previewBox, others, options)
      : EMPTY_SMART_GUIDE_OVERLAY,
  };
}

// ---------------------------------------------------------------------------
// 3) 상태 갱신 보조
// ---------------------------------------------------------------------------

/**
 * 오버레이 내용 동등 비교 — 드래그 매 프레임 setState 시 값이 같으면 이전 참조를
 * 유지해(applyGuides 와 같은 패턴) StudioPage 전체 리렌더를 억제하는 용도.
 */
export function smartGuideOverlaysEqual(a: SmartGuideOverlay, b: SmartGuideOverlay): boolean {
  if (a === b) return true;
  if (a.segments.length !== b.segments.length || a.spacings.length !== b.spacings.length) return false;
  for (let i = 0; i < a.segments.length; i++) {
    const s = a.segments[i];
    const t = b.segments[i];
    if (s.axis !== t.axis || s.pos !== t.pos || s.from !== t.from || s.to !== t.to || s.kind !== t.kind) return false;
  }
  for (let i = 0; i < a.spacings.length; i++) {
    const s = a.spacings[i];
    const t = b.spacings[i];
    if (s.axis !== t.axis || s.gap !== t.gap || s.at !== t.at || s.spans.length !== t.spans.length) return false;
    for (let j = 0; j < s.spans.length; j++) {
      if (s.spans[j].from !== t.spans[j].from || s.spans[j].to !== t.spans[j].to) return false;
    }
  }
  return true;
}
