/**
 * Studio Vector Erase-to-Intersection — 벡터 지우개 "교점까지 지우기" 순수 코어.
 *
 * CSP(클립스튜디오) 벡터 레이어 지우개의 대표 기능. 선 위 한 점을 누르면 그 선이 **다른 선과
 * 교차하는 가장 가까운 두 지점** 사이만 지워, 교차점 밖으로 삐져나온 선 끝(overhang)을 한 번에
 * 정리한다. 선화 정리 속도를 좌우하는 기능이라 갭 감사에서 "없음"으로 잡혔다.
 *
 * 다루는 대상: DrawEl(kind="freehand")의 평탄 points 배열([x0,y0,x1,y1,...])로 표현된 폴리라인.
 * studio-node-edit.ts 와 동일하게 points 는 이미 페이지(캔버스) 좌표계라 별도 프레임 변환이
 * 없다. 곡선 리샘플링·스무딩을 하지 않으므로 살아남은 조각은 원본 점을 그대로 물려받는다
 * (절단면 두 점만 새로 보간) — 기존 렌더 파이프라인이 결과를 그대로 다시 그린다.
 *
 * 포인트별 속성(pressures/tiltXs/tiltYs/twists/speeds/tangentialPressures)은 원본 점에서는
 * 원본 값을, 절단면에서는 이웃 두 점 사이 선형 보간값을 갖는다. **입력에 없던 키는 만들어내지
 * 않는다** — studio-node-edit 의 withPressureEdited 가 "필압 배열 승격"으로 굵기를 눈에 띄게
 * 바꿨던 회귀와 같은 함정을 피하기 위한 계약이다.
 *
 * 순수·결정적 — DOM/Konva/난수/시간/전역 의존 없음. 입력 배열은 절대 변형하지 않는다.
 *
 * ---------------------------------------------------------------------------
 * 강건성(robustness) 결정 — 아래 4가지는 테스트로 고정된 계약이다.
 * ---------------------------------------------------------------------------
 * 1. **근접 평행/접선(near-tangent) 판정은 각도 기준.** 두 선분의 외적 |r×s| 는 |r||s|sinθ 와
 *    같으므로, `|r×s| <= parallelSinEpsilon * |r| * |s|` 는 곧 `sinθ <= ε` 이다 — 좌표 스케일에
 *    영향받지 않는다(길이로 나눈 절대 외적 임계값을 쓰면 캔버스가 커질수록 오판이 늘어난다).
 *    기본 ε = 1e-9(≈5.7e-8도). 이보다 얕은 교차는 교점 파라미터 t=(q−p)×s / (r×s) 의 분모가
 *    0에 가까워 값을 신뢰할 수 없으므로, 점 교차 대신 아래 (2) 공선 겹침 판정으로 넘긴다.
 * 2. **공선 겹침(collinear overlap)은 구간의 양 끝 두 점을 교점으로 낸다.** 평행으로 판정된
 *    쌍은 상대 선분 시작점의 수직거리가 collinearDistancePx(기본 1e-6px) 이내일 때만 공선으로
 *    보고, 대상 파라미터 공간에 투영한 겹침 구간 [from,to] 의 경계를 교점으로 기록한다. 겹쳐
 *    누운 구간 전체가 지워지도록 하는 정의이며, from==to(한 점 접촉)면 교점 1개만 낸다.
 * 3. **끝점 접촉(T자 이음·공유 끝점)은 유효한 교점.** 파라미터 허용치는 픽셀 허용치를 선분
 *    길이로 나눠 파라미터 단위로 환산한다(`touchTolerancePx/|r| + 1e-9`). 기본
 *    touchTolerancePx=0 이라 기하학적으로 닿은 경우만 인정하고, 1e-9 슬랙은 정확히 닿은
 *    끝점이 부동소수 오차(-1e-17)로 탈락하는 것만 막는다. 선 굵기만큼의 "거의 닿음"을
 *    붙이고 싶으면 호출부가 touchTolerancePx 에 strokeWidth/2 를 넘긴다.
 * 4. **중복 교점은 호길이 기준으로만 병합한다.** 상대 선의 꼭짓점이 대상 꼭짓점에 정확히
 *    떨어지면 인접한 두 대상 선분이 같은 위치를 각각 보고한다 — 호길이가 같으므로 병합된다.
 *    반대로 자기교차의 두 교점은 좌표가 같아도 호길이가 다르므로 **병합되지 않는다**(둘 다
 *    독립된 절단 후보여야 고리 모양 자기교차가 올바르게 잘린다). 좌표 기준 병합이 아니라
 *    호길이 기준 병합인 이유다.
 *
 * 닫힌 고리(closed loop)는 이음매(seam)를 넘어 순환 브래킷을 적용한다 — 고리 위 두 교점
 * 사이를 지우면 남는 조각은 이음매를 통과하는 **한 조각**이다(열린 선처럼 두 조각이 아니다).
 */

// ---------------------------------------------------------------------------
// UI 라벨(패널·툴팁 재사용용 — 로직에는 관여하지 않는다)
// ---------------------------------------------------------------------------

export const STUDIO_ERASE_TO_INTERSECTION_LABEL = "교점까지 지우기";
export const STUDIO_ERASE_TO_INTERSECTION_TIP =
  "선을 누르면 다른 선과 만나는 가장 가까운 두 지점 사이만 지워, 삐져나온 선 끝을 한 번에 정리합니다.";

// ---------------------------------------------------------------------------
// 상수(엡실론) — 모두 옵션으로 덮어쓸 수 있다.
// ---------------------------------------------------------------------------

/** 근접 평행 판정 임계값 = sinθ 상한. 파일 헤더 (1) 참고. */
export const STUDIO_ERASE_PARALLEL_SIN_EPSILON = 1e-9;
/** 평행 쌍을 "공선"으로 인정할 수직거리(px). 파일 헤더 (2) 참고. */
export const STUDIO_ERASE_COLLINEAR_DISTANCE_PX = 1e-6;
/** 정확히 닿은 끝점이 부동소수 오차로 탈락하지 않도록 하는 파라미터 슬랙. 파일 헤더 (3) 참고. */
export const STUDIO_ERASE_PARAM_EPSILON = 1e-9;
/** 같은 교점으로 볼 호길이 거리(px). 파일 헤더 (4) 참고. */
export const STUDIO_ERASE_MERGE_DISTANCE_PX = 1e-4;
/** 첫 점과 끝 점이 이 거리(px) 안이면 닫힌 고리로 본다. 기본은 사실상 "정확히 닫힘". */
export const STUDIO_ERASE_CLOSED_LOOP_TOLERANCE_PX = 1e-6;
/** 선분쌍 검사 상한(폭주 방지). 초과하면 ok:false 로 안전하게 포기한다. */
export const STUDIO_ERASE_MAX_SEGMENT_PAIRS = 4_000_000;

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export type StudioErasePoint = { x: number; y: number };

/** 폴리라인 위 위치 — segmentIndex 번째 선분의 t(0..1) 지점. */
export type StudioStrokeParam = { segmentIndex: number; t: number };

/** DrawEl 이 실제로 저장하는 포인트별(=점당 1개) 숫자 배열 키. */
export const STUDIO_STROKE_PER_POINT_ATTRIBUTE_KEYS = [
  "pressures",
  "tiltXs",
  "tiltYs",
  "twists",
  "speeds",
  "tangentialPressures",
] as const;

export type StudioStrokePerPointAttributeKey =
  (typeof STUDIO_STROKE_PER_POINT_ATTRIBUTE_KEYS)[number];

/** 입력 속성 — 없는 키는 결과에서도 생기지 않는다. */
export type StudioStrokePerPointAttributes = {
  readonly [K in StudioStrokePerPointAttributeKey]?: readonly number[];
};

/** 출력 속성 — 입력에 있던(그리고 유한값이 하나라도 있던) 키만 담긴다. */
export type StudioStrokePerPointAttributeOutput = {
  [K in StudioStrokePerPointAttributeKey]?: number[];
};

export interface StudioEraseStrokeInput {
  readonly points: readonly number[];
  readonly attributes?: StudioStrokePerPointAttributes;
}

/** 확정된 절단점(교점) 1개. */
export interface StudioStrokeCut extends StudioStrokeParam {
  readonly x: number;
  readonly y: number;
  /** 스트로크 시작점부터의 호길이(px). */
  readonly arcLength: number;
  /** "self" = 대상 스트로크 자기교차, "other" = 다른 스트로크와의 교차. */
  readonly source: "self" | "other";
  /** others 배열 인덱스(source==="other"일 때). self 면 -1. */
  readonly otherIndex: number;
  /** 공선 겹침 구간의 경계에서 나온 교점인지. */
  readonly collinear: boolean;
}

/** 살아남은 조각 1개. */
export interface StudioStrokePiece {
  points: number[];
  attributes: StudioStrokePerPointAttributeOutput;
  lengthPx: number;
  /** 원본에서 이 조각이 차지하던 호길이 구간. 닫힌 고리 이음매를 넘는 조각은 to < from. */
  fromArcLength: number;
  toArcLength: number;
}

export interface StudioStrokeHitLocation extends StudioStrokeParam {
  readonly x: number;
  readonly y: number;
  readonly arcLength: number;
  /** 히트 입력 지점과 선 위 투영점 사이 거리(px). 파라미터로 직접 지정했으면 0. */
  readonly distancePx: number;
}

export interface StudioEraseToIntersectionOptions {
  /** 끝점 접촉 허용 픽셀(기본 0). 선 굵기를 반영하려면 strokeWidth/2 정도를 넘긴다. */
  readonly touchTolerancePx?: number;
  /** 근접 평행 판정 sinθ 상한(기본 STUDIO_ERASE_PARALLEL_SIN_EPSILON). */
  readonly parallelSinEpsilon?: number;
  /** 평행 쌍을 공선으로 볼 수직거리 px(기본 STUDIO_ERASE_COLLINEAR_DISTANCE_PX). */
  readonly collinearDistancePx?: number;
  /** 교점 병합 호길이 거리 px(기본 STUDIO_ERASE_MERGE_DISTANCE_PX). */
  readonly mergeDistancePx?: number;
  /** 닫힌 고리 판정 허용 px(기본 STUDIO_ERASE_CLOSED_LOOP_TOLERANCE_PX). */
  readonly closedLoopTolerancePx?: number;
  /** 지정하면 히트 지점이 선에서 이 거리 밖일 때 ok:false 로 거절한다. */
  readonly hitTolerancePx?: number;
  /** 자기교차도 절단 후보로 쓸지(기본 true). */
  readonly includeSelfIntersections?: boolean;
  /** 선분쌍 검사 상한(기본 STUDIO_ERASE_MAX_SEGMENT_PAIRS). */
  readonly maxSegmentPairs?: number;
}

export type StudioEraseToIntersectionResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** 0개(전부 지움) · 1개(한쪽만 남음/닫힌 고리) · 2개(가운데 구간을 지움). */
      pieces: StudioStrokePiece[];
      /** 정렬·중복제거된 전체 교점(오버레이 미리보기용). */
      cuts: StudioStrokeCut[];
      /** 지워지는 구간의 시작 교점. null = 스트로크 시작까지 지움(열린 선의 overhang). */
      erasedFrom: StudioStrokeCut | null;
      /** 지워지는 구간의 끝 교점. null = 스트로크 끝까지 지움. */
      erasedTo: StudioStrokeCut | null;
      erasedLengthPx: number;
      closedLoop: boolean;
      hit: StudioStrokeHitLocation;
    };

// ---------------------------------------------------------------------------
// 내부 지오메트리
// ---------------------------------------------------------------------------

interface StrokeSegment {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly dx: number;
  readonly dy: number;
  readonly length: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface StrokeGeometry {
  readonly points: readonly number[];
  readonly pointCount: number;
  readonly segments: readonly StrokeSegment[];
  /** 각 정점까지의 누적 호길이(길이 pointCount). */
  readonly arc: readonly number[];
  readonly totalLength: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

function makeSegment(x0: number, y0: number, x1: number, y1: number): StrokeSegment {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return {
    x0,
    y0,
    x1,
    y1,
    dx,
    dy,
    length: Math.hypot(dx, dy),
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
}

/**
 * 폴리라인 지오메트리 — 좌표가 하나라도 비유한이면 null(대상 스트로크는 거절, 상대는 무시).
 * 길이 0 선분(중복점)도 인덱스 정합을 위해 그대로 유지하되 교차 검사에서만 제외된다.
 */
function buildStrokeGeometry(points: readonly number[]): StrokeGeometry | null {
  const pointCount = Math.floor(points.length / 2);
  if (pointCount < 2) return null;
  const segments: StrokeSegment[] = [];
  const arc: number[] = new Array<number>(pointCount);
  arc[0] = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < pointCount; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (i > 0) {
      const px = points[(i - 1) * 2] as number;
      const py = points[(i - 1) * 2 + 1] as number;
      const seg = makeSegment(px, py, x, y);
      segments.push(seg);
      arc[i] = (arc[i - 1] as number) + seg.length;
    }
  }
  return {
    points,
    pointCount,
    segments,
    arc,
    totalLength: arc[pointCount - 1] as number,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

// ---------------------------------------------------------------------------
// 선분–선분 교차
// ---------------------------------------------------------------------------

/** 한 쌍의 선분에서 나온 교차 — tA/tB 는 각 선분의 0..1 파라미터. */
export interface StudioSegmentIntersection {
  readonly tA: number;
  readonly tB: number;
  readonly collinear: boolean;
}

interface SegmentIntersectionTuning {
  readonly touchTolerancePx: number;
  readonly parallelSinEpsilon: number;
  readonly collinearDistancePx: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** b 위의 점 (x,y) 를 b 파라미터로 투영(0..1 클램프). */
function projectParam(seg: StrokeSegment, x: number, y: number): number {
  const denom = seg.dx * seg.dx + seg.dy * seg.dy;
  if (denom <= 0) return 0;
  return clamp01(((x - seg.x0) * seg.dx + (y - seg.y0) * seg.dy) / denom);
}

/**
 * 두 선분의 교차점 목록(0·1·2개). 순수·결정적.
 *
 * - 일반 교차 → 1개. 파라미터 허용치는 픽셀 허용치를 선분 길이로 환산한다(헤더 (3)).
 * - 근접 평행(헤더 (1)) 중 공선이고 겹치면 → 겹침 구간의 경계 1~2개(헤더 (2)).
 * - 길이 0 선분·평행 비공선·겹치지 않는 공선 → 0개.
 */
export function intersectStudioSegments(
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
  options?: Pick<
    StudioEraseToIntersectionOptions,
    "touchTolerancePx" | "parallelSinEpsilon" | "collinearDistancePx"
  >
): StudioSegmentIntersection[] {
  const segA = makeSegment(a.x0, a.y0, a.x1, a.y1);
  const segB = makeSegment(b.x0, b.y0, b.x1, b.y1);
  return intersectSegmentPair(segA, segB, {
    touchTolerancePx: nonNegativeOr(options?.touchTolerancePx, 0),
    parallelSinEpsilon: positiveOr(options?.parallelSinEpsilon, STUDIO_ERASE_PARALLEL_SIN_EPSILON),
    collinearDistancePx: nonNegativeOr(
      options?.collinearDistancePx,
      STUDIO_ERASE_COLLINEAR_DISTANCE_PX
    ),
  });
}

function intersectSegmentPair(
  a: StrokeSegment,
  b: StrokeSegment,
  tuning: SegmentIntersectionTuning
): StudioSegmentIntersection[] {
  if (a.length <= 0 || b.length <= 0) return [];
  if (
    !Number.isFinite(b.x0) ||
    !Number.isFinite(b.y0) ||
    !Number.isFinite(b.x1) ||
    !Number.isFinite(b.y1)
  ) {
    return [];
  }
  const cross = a.dx * b.dy - a.dy * b.dx;
  const qpx = b.x0 - a.x0;
  const qpy = b.y0 - a.y0;

  // 근접 평행 — 각도 기준(|r×s| = |r||s|sinθ).
  if (Math.abs(cross) <= tuning.parallelSinEpsilon * a.length * b.length) {
    const perpendicular = Math.abs(qpx * a.dy - qpy * a.dx) / a.length;
    if (perpendicular > tuning.collinearDistancePx) return [];
    const rr = a.dx * a.dx + a.dy * a.dy;
    const t0 = (qpx * a.dx + qpy * a.dy) / rr;
    const t1 = ((b.x1 - a.x0) * a.dx + (b.y1 - a.y0) * a.dy) / rr;
    const slack = tuning.touchTolerancePx / a.length + STUDIO_ERASE_PARAM_EPSILON;
    const from = Math.max(0, Math.min(t0, t1));
    const to = Math.min(1, Math.max(t0, t1));
    if (from > to + slack) return [];
    const lo = clamp01(from);
    const hi = clamp01(to);
    const loPoint: StudioSegmentIntersection = {
      tA: lo,
      tB: projectParam(b, a.x0 + a.dx * lo, a.y0 + a.dy * lo),
      collinear: true,
    };
    if (hi - lo <= STUDIO_ERASE_PARAM_EPSILON) return [loPoint];
    return [
      loPoint,
      {
        tA: hi,
        tB: projectParam(b, a.x0 + a.dx * hi, a.y0 + a.dy * hi),
        collinear: true,
      },
    ];
  }

  const tA = (qpx * b.dy - qpy * b.dx) / cross;
  const tB = (qpx * a.dy - qpy * a.dx) / cross;
  const slackA = tuning.touchTolerancePx / a.length + STUDIO_ERASE_PARAM_EPSILON;
  const slackB = tuning.touchTolerancePx / b.length + STUDIO_ERASE_PARAM_EPSILON;
  if (tA < -slackA || tA > 1 + slackA) return [];
  if (tB < -slackB || tB > 1 + slackB) return [];
  return [{ tA: clamp01(tA), tB: clamp01(tB), collinear: false }];
}

// ---------------------------------------------------------------------------
// 파라미터 정규화·비교
// ---------------------------------------------------------------------------

/** t≈1 은 다음 선분의 t=0 으로, t≈0 은 정확히 0 으로 — 같은 위치가 항상 같은 표현을 갖게 한다. */
function normalizeParam(geo: StrokeGeometry, segmentIndex: number, t: number): StudioStrokeParam {
  const lastSegment = geo.segments.length - 1;
  const index = segmentIndex < 0 ? 0 : segmentIndex > lastSegment ? lastSegment : segmentIndex;
  const clamped = clamp01(t);
  if (clamped >= 1 - STUDIO_ERASE_PARAM_EPSILON) {
    return index < lastSegment
      ? { segmentIndex: index + 1, t: 0 }
      : { segmentIndex: index, t: 1 };
  }
  if (clamped <= STUDIO_ERASE_PARAM_EPSILON) return { segmentIndex: index, t: 0 };
  return { segmentIndex: index, t: clamped };
}

export function compareStudioStrokeParams(a: StudioStrokeParam, b: StudioStrokeParam): number {
  if (a.segmentIndex !== b.segmentIndex) return a.segmentIndex - b.segmentIndex;
  return a.t - b.t;
}

function vertexParam(geo: StrokeGeometry, vertexIndex: number): StudioStrokeParam {
  const lastSegment = geo.segments.length - 1;
  return vertexIndex < geo.segments.length
    ? { segmentIndex: vertexIndex, t: 0 }
    : { segmentIndex: lastSegment, t: 1 };
}

function paramPoint(geo: StrokeGeometry, param: StudioStrokeParam): StudioErasePoint {
  const seg = geo.segments[param.segmentIndex] as StrokeSegment;
  return { x: seg.x0 + seg.dx * param.t, y: seg.y0 + seg.dy * param.t };
}

function paramArcLength(geo: StrokeGeometry, param: StudioStrokeParam): number {
  const base = geo.arc[param.segmentIndex] as number;
  const seg = geo.segments[param.segmentIndex] as StrokeSegment;
  return base + seg.length * param.t;
}

// ---------------------------------------------------------------------------
// 히트 위치
// ---------------------------------------------------------------------------

/**
 * 페이지 좌표 한 점을 폴리라인 위로 투영해 가장 가까운 위치를 찾는다(결정적 — 동률이면 앞 선분).
 * points 가 2점 미만이거나 비유한 좌표를 포함하면 null.
 */
export function locateStudioStrokeHit(
  points: readonly number[],
  point: StudioErasePoint
): StudioStrokeHitLocation | null {
  const geo = buildStrokeGeometry(points);
  if (!geo) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return locateHitOnGeometry(geo, point);
}

function locateHitOnGeometry(geo: StrokeGeometry, point: StudioErasePoint): StudioStrokeHitLocation {
  let bestIndex = 0;
  let bestT = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < geo.segments.length; i++) {
    const seg = geo.segments[i] as StrokeSegment;
    const t = seg.length <= 0 ? 0 : projectParam(seg, point.x, point.y);
    const px = seg.x0 + seg.dx * t;
    const py = seg.y0 + seg.dy * t;
    const distance = Math.hypot(px - point.x, py - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestT = t;
    }
  }
  const param = normalizeParam(geo, bestIndex, bestT);
  const projected = paramPoint(geo, param);
  return {
    ...param,
    x: projected.x,
    y: projected.y,
    arcLength: paramArcLength(geo, param),
    distancePx: bestDistance,
  };
}

// ---------------------------------------------------------------------------
// 교점 수집
// ---------------------------------------------------------------------------

interface CutCollectionOutcome {
  readonly ok: boolean;
  readonly cuts: StudioStrokeCut[];
}

function bboxDisjoint(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
  pad: number
): boolean {
  return (
    a.maxX + pad < b.minX || b.maxX + pad < a.minX || a.maxY + pad < b.minY || b.maxY + pad < a.minY
  );
}

function makeCut(
  geo: StrokeGeometry,
  segmentIndex: number,
  t: number,
  source: "self" | "other",
  otherIndex: number,
  collinear: boolean
): StudioStrokeCut {
  const param = normalizeParam(geo, segmentIndex, t);
  const point = paramPoint(geo, param);
  return {
    ...param,
    x: point.x,
    y: point.y,
    arcLength: paramArcLength(geo, param),
    source,
    otherIndex,
    collinear,
  };
}

function isClosedLoop(geo: StrokeGeometry, tolerancePx: number): boolean {
  const last = geo.pointCount - 1;
  const x0 = geo.points[0] as number;
  const y0 = geo.points[1] as number;
  const x1 = geo.points[last * 2] as number;
  const y1 = geo.points[last * 2 + 1] as number;
  return Math.hypot(x1 - x0, y1 - y0) <= tolerancePx && geo.totalLength > 0;
}

/**
 * 공선 겹침 구간 하나 — 대상의 호길이 공간에서 [from, to].
 *
 * 왜 구간으로 모으는가: 대상 폴리라인은 잘게 쪼개져 있어서, 상대 선 하나가 여러 대상 선분에
 * 걸쳐 겹쳐 눕는다. 선분쌍마다 나온 겹침 경계를 그대로 교점으로 쓰면 **대상의 정점 위치가
 * 교점으로 둔갑한다**(x=20..60 이 겹쳤는데 20/30/40/50/60 다섯 개가 잡히는 회귀). 구간으로
 * 모아 이어붙인 뒤 병합된 구간의 양 끝만 교점으로 승격시켜야 실제 겹침 경계만 남는다.
 */
interface CollinearRun {
  from: StudioStrokeCut;
  to: StudioStrokeCut;
}

function collectCuts(
  geo: StrokeGeometry,
  others: readonly (readonly number[])[],
  tuning: SegmentIntersectionTuning,
  closed: boolean,
  includeSelf: boolean,
  maxSegmentPairs: number,
  mergeDistancePx: number
): CutCollectionOutcome {
  const cuts: StudioStrokeCut[] = [];
  const runs: CollinearRun[] = [];
  const pad = tuning.touchTolerancePx + tuning.collinearDistancePx;
  let pairs = 0;

  /** 한 선분쌍의 결과를 점 교점 또는 공선 구간으로 분류해 담는다. */
  const absorb = (
    hits: readonly StudioSegmentIntersection[],
    segmentIndex: number,
    pick: (hit: StudioSegmentIntersection) => number,
    source: "self" | "other",
    otherIndex: number
  ) => {
    const first = hits[0];
    if (!first) return;
    if (first.collinear && hits.length === 2) {
      const second = hits[1] as StudioSegmentIntersection;
      const lo = Math.min(pick(first), pick(second));
      const hi = Math.max(pick(first), pick(second));
      runs.push({
        from: makeCut(geo, segmentIndex, lo, source, otherIndex, true),
        to: makeCut(geo, segmentIndex, hi, source, otherIndex, true),
      });
      return;
    }
    for (const hit of hits) {
      cuts.push(makeCut(geo, segmentIndex, pick(hit), source, otherIndex, hit.collinear));
    }
  };

  // 길이 0 선분(중복점)만 사이에 낀 두 선분은 "인덱스는 떨어져 있지만 실제로는 이웃"이다 —
  // 이 보정이 없으면 중복점 하나가 가짜 자기교차를 만든다.
  const nonDegenerateBefore = new Array<number>(geo.segments.length + 1);
  nonDegenerateBefore[0] = 0;
  for (let i = 0; i < geo.segments.length; i++) {
    nonDegenerateBefore[i + 1] =
      (nonDegenerateBefore[i] as number) + ((geo.segments[i] as StrokeSegment).length > 0 ? 1 : 0);
  }
  const nonDegenerateTotal = nonDegenerateBefore[geo.segments.length] as number;

  if (includeSelf) {
    for (let i = 0; i < geo.segments.length; i++) {
      const a = geo.segments[i] as StrokeSegment;
      for (let j = i + 2; j < geo.segments.length; j++) {
        // 이웃 선분은 정의상 끝점을 공유하므로 자기교차가 아니다. 닫힌 고리는 이음매에서
        // 첫/끝 선분도 끝점을 공유하므로 같은 이유로 제외한다.
        if ((nonDegenerateBefore[j] as number) - (nonDegenerateBefore[i + 1] as number) === 0) {
          continue;
        }
        if (
          closed &&
          (nonDegenerateBefore[i] as number) === 0 &&
          nonDegenerateTotal - (nonDegenerateBefore[j + 1] as number) === 0
        ) {
          continue;
        }
        if (++pairs > maxSegmentPairs) return { ok: false, cuts: [] };
        const b = geo.segments[j] as StrokeSegment;
        if (bboxDisjoint(a, b, pad)) continue;
        const hits = intersectSegmentPair(a, b, tuning);
        absorb(hits, i, (hit) => hit.tA, "self", -1);
        absorb(hits, j, (hit) => hit.tB, "self", -1);
      }
    }
  }

  for (let oi = 0; oi < others.length; oi++) {
    const raw = others[oi];
    if (!raw) continue;
    const other = buildStrokeGeometry(raw);
    if (!other) continue;
    if (bboxDisjoint(geo, other, pad)) continue;
    for (let i = 0; i < geo.segments.length; i++) {
      const a = geo.segments[i] as StrokeSegment;
      if (bboxDisjoint(a, other, pad)) continue;
      for (let j = 0; j < other.segments.length; j++) {
        if (++pairs > maxSegmentPairs) return { ok: false, cuts: [] };
        const b = other.segments[j] as StrokeSegment;
        if (bboxDisjoint(a, b, pad)) continue;
        absorb(intersectSegmentPair(a, b, tuning), i, (hit) => hit.tA, "other", oi);
      }
    }
  }

  const mergedRuns = mergeCollinearRuns(runs, mergeDistancePx);
  // 겹침 구간 **안쪽**의 공선 한 점 접촉은 교점이 아니다 — 상대 선 두 개가 같은 직선 위에서
  // 끝끼리 맞닿은 위치일 뿐이라, 지우기 경계로 쓰면 겹침 구간이 임의로 쪼개진다. 반면 구간을
  // 가로지르는 **실제 교차**(collinear=false)는 그대로 살린다.
  const kept = cuts.filter(
    (cut) => !cut.collinear || !isStrictlyInsideRun(cut, mergedRuns, mergeDistancePx)
  );
  for (const run of mergedRuns) {
    kept.push(run.from);
    if (run.to.arcLength - run.from.arcLength > mergeDistancePx) kept.push(run.to);
  }
  return { ok: true, cuts: kept };
}

function isStrictlyInsideRun(
  cut: StudioStrokeCut,
  runs: readonly CollinearRun[],
  mergeDistancePx: number
): boolean {
  return runs.some(
    (run) =>
      cut.arcLength > run.from.arcLength + mergeDistancePx &&
      cut.arcLength < run.to.arcLength - mergeDistancePx
  );
}

/** 이어지거나 겹치는 공선 구간을 하나로 잇는다(대상 호길이 기준, 결정적). */
function mergeCollinearRuns(runs: readonly CollinearRun[], mergeDistancePx: number): CollinearRun[] {
  const sorted = runs
    .slice()
    .sort((a, b) => a.from.arcLength - b.from.arcLength || a.to.arcLength - b.to.arcLength);
  const merged: CollinearRun[] = [];
  for (const run of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && run.from.arcLength <= previous.to.arcLength + mergeDistancePx) {
      if (run.to.arcLength > previous.to.arcLength) previous.to = run.to;
      continue;
    }
    merged.push({ from: run.from, to: run.to });
  }
  return merged;
}

/** 파라미터 오름차순 정렬 + 호길이 기준 중복 병합(헤더 (4)). Array#sort 는 안정 정렬이라 결정적. */
function sortAndMergeCuts(cuts: StudioStrokeCut[], mergeDistancePx: number): StudioStrokeCut[] {
  const sorted = cuts.slice().sort(compareStudioStrokeParams);
  const merged: StudioStrokeCut[] = [];
  for (const cut of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && Math.abs(cut.arcLength - previous.arcLength) <= mergeDistancePx) continue;
    merged.push(cut);
  }
  return merged;
}

/**
 * 대상 스트로크의 절단 후보(교점)를 전부 계산한다 — 정렬·중복제거된 결과.
 * 오버레이 미리보기(교점 표시)에도 그대로 쓸 수 있다. 실패(선분쌍 상한 초과)면 null.
 */
export function findStudioStrokeCuts(
  points: readonly number[],
  others: readonly (readonly number[])[],
  options?: StudioEraseToIntersectionOptions
): StudioStrokeCut[] | null {
  const geo = buildStrokeGeometry(points);
  if (!geo) return null;
  const tuning = resolveTuning(options);
  const mergeDistancePx = nonNegativeOr(options?.mergeDistancePx, STUDIO_ERASE_MERGE_DISTANCE_PX);
  const closed = isClosedLoop(
    geo,
    nonNegativeOr(options?.closedLoopTolerancePx, STUDIO_ERASE_CLOSED_LOOP_TOLERANCE_PX)
  );
  const outcome = collectCuts(
    geo,
    others,
    tuning,
    closed,
    options?.includeSelfIntersections !== false,
    positiveOr(options?.maxSegmentPairs, STUDIO_ERASE_MAX_SEGMENT_PAIRS),
    mergeDistancePx
  );
  if (!outcome.ok) return null;
  return sortAndMergeCuts(outcome.cuts, mergeDistancePx);
}

function resolveTuning(options?: StudioEraseToIntersectionOptions): SegmentIntersectionTuning {
  return {
    touchTolerancePx: nonNegativeOr(options?.touchTolerancePx, 0),
    parallelSinEpsilon: positiveOr(options?.parallelSinEpsilon, STUDIO_ERASE_PARALLEL_SIN_EPSILON),
    collinearDistancePx: nonNegativeOr(
      options?.collinearDistancePx,
      STUDIO_ERASE_COLLINEAR_DISTANCE_PX
    ),
  };
}

// ---------------------------------------------------------------------------
// 포인트별 속성 — 조밀화(dense) + 보간
// ---------------------------------------------------------------------------

/**
 * 원본 속성 배열을 pointCount 길이의 조밀 배열로 정규화한다.
 *  - 배열이 짧으면 마지막 값으로 채운다(길면 잘라낸다) — 없는 값을 상수로 "발명"하지 않는다.
 *  - 비유한 값은 가장 가까운 유한 이웃 값으로 메운다. 유한 값이 하나도 없으면 null(키 제거).
 */
function densifyAttribute(raw: readonly number[], pointCount: number): number[] | null {
  if (pointCount <= 0 || raw.length === 0) return null;
  const holes: (number | undefined)[] = new Array<number | undefined>(pointCount);
  let firstFinite: number | undefined;
  for (let i = 0; i < pointCount; i++) {
    const value = raw[i < raw.length ? i : raw.length - 1];
    const usable = typeof value === "number" && Number.isFinite(value);
    holes[i] = usable ? value : undefined;
    if (usable && firstFinite === undefined) firstFinite = value;
  }
  if (firstFinite === undefined) return null;
  // 앞으로 채우기(직전 유한값 유지) + 선두 구멍은 첫 유한값으로 되메우기.
  const dense = new Array<number>(pointCount);
  let carry = firstFinite;
  for (let i = 0; i < pointCount; i++) {
    const value = holes[i];
    if (value !== undefined) carry = value;
    dense[i] = carry;
  }
  return dense;
}

type DenseAttributes = { key: StudioStrokePerPointAttributeKey; values: number[] }[];

function densifyAttributes(
  attributes: StudioStrokePerPointAttributes | undefined,
  pointCount: number
): DenseAttributes {
  if (!attributes) return [];
  const out: DenseAttributes = [];
  for (const key of STUDIO_STROKE_PER_POINT_ATTRIBUTE_KEYS) {
    const raw = attributes[key];
    if (!raw) continue;
    const values = densifyAttribute(raw, pointCount);
    if (values) out.push({ key, values });
  }
  return out;
}

function attributeAtParam(values: readonly number[], param: StudioStrokeParam): number {
  const a = values[param.segmentIndex] as number;
  const b = values[param.segmentIndex + 1];
  if (b === undefined) return a;
  return a + (b - a) * param.t;
}

// ---------------------------------------------------------------------------
// 조각 만들기
// ---------------------------------------------------------------------------

function sameParam(a: StudioStrokeParam, b: StudioStrokeParam): boolean {
  return a.segmentIndex === b.segmentIndex && Math.abs(a.t - b.t) <= STUDIO_ERASE_PARAM_EPSILON;
}

/** [from, to] 구간(from <= to)을 이루는 샘플 파라미터 목록 — 절단면 2개 + 그 사이 원본 정점들. */
function collectSampleParams(
  geo: StrokeGeometry,
  from: StudioStrokeParam,
  to: StudioStrokeParam
): StudioStrokeParam[] {
  const out: StudioStrokeParam[] = [from];
  for (let k = 0; k < geo.pointCount; k++) {
    const vp = vertexParam(geo, k);
    if (compareStudioStrokeParams(vp, from) > 0 && compareStudioStrokeParams(vp, to) < 0) {
      out.push(vp);
    }
  }
  out.push(to);
  const deduped: StudioStrokeParam[] = [];
  for (const param of out) {
    const previous = deduped[deduped.length - 1];
    if (previous && sameParam(previous, param)) continue;
    deduped.push(param);
  }
  return deduped;
}

function buildPiece(
  geo: StrokeGeometry,
  attributes: DenseAttributes,
  samples: readonly StudioStrokeParam[],
  fromArcLength: number,
  toArcLength: number
): StudioStrokePiece | null {
  if (samples.length < 2) return null;
  const points: number[] = [];
  const output: StudioStrokePerPointAttributeOutput = {};
  const buffers = attributes.map((entry) => ({ key: entry.key, values: [] as number[] }));
  let lengthPx = 0;
  let previousX = 0;
  let previousY = 0;
  for (let i = 0; i < samples.length; i++) {
    const param = samples[i] as StudioStrokeParam;
    const point = paramPoint(geo, param);
    points.push(point.x, point.y);
    for (let a = 0; a < attributes.length; a++) {
      const entry = attributes[a] as DenseAttributes[number];
      (buffers[a] as { values: number[] }).values.push(attributeAtParam(entry.values, param));
    }
    if (i > 0) lengthPx += Math.hypot(point.x - previousX, point.y - previousY);
    previousX = point.x;
    previousY = point.y;
  }
  if (lengthPx <= 0) return null;
  for (const buffer of buffers) output[buffer.key] = buffer.values;
  return { points, attributes: output, lengthPx, fromArcLength, toArcLength };
}

// ---------------------------------------------------------------------------
// 메인 — 교점까지 지우기 계획
// ---------------------------------------------------------------------------

/**
 * 대상 스트로크의 히트 지점을 감싸는 가장 가까운 두 교점을 찾아 그 사이를 지운 결과를 만든다.
 *
 * - 열린 선: 한쪽에 교점이 없으면 그쪽은 스트로크 끝까지 지운다(= 삐져나온 선 끝 정리).
 *   양쪽 모두 없으면(교점 0개) 스트로크 전체가 지워진다 — pieces = [].
 * - 닫힌 고리: 이음매를 넘는 순환 브래킷을 적용해 남는 조각은 항상 1개(교점 1개 이하면 0개).
 *
 * others 에는 "지금 화면에 보이는 다른 스트로크"의 평탄 points 배열만 넘긴다(숨김/잠금 필터링과
 * 도형→폴리라인 전개는 호출부 책임 — 이 모듈은 DOM/문서 모델을 모른다).
 */
export function planStudioEraseToIntersection(
  target: StudioEraseStrokeInput,
  hit: StudioErasePoint | StudioStrokeParam,
  others: readonly (readonly number[])[],
  options?: StudioEraseToIntersectionOptions
): StudioEraseToIntersectionResult {
  const geo = buildStrokeGeometry(target.points);
  if (!geo) {
    return { ok: false, reason: "점이 2개 이상인 자유선에서만 교점까지 지울 수 있어요." };
  }
  if (geo.totalLength <= 0) {
    return { ok: false, reason: "길이가 없는 선이라 지울 구간을 찾을 수 없어요." };
  }

  const hitLocation = resolveHitLocation(geo, hit);
  if (!hitLocation) {
    return { ok: false, reason: "선 위의 지점을 찾을 수 없어요." };
  }
  const hitTolerance = options?.hitTolerancePx;
  if (
    typeof hitTolerance === "number" &&
    Number.isFinite(hitTolerance) &&
    hitLocation.distancePx > hitTolerance
  ) {
    return { ok: false, reason: "선에서 너무 떨어진 곳이에요. 선 위를 눌러 주세요." };
  }

  const tuning = resolveTuning(options);
  const mergeDistancePx = nonNegativeOr(options?.mergeDistancePx, STUDIO_ERASE_MERGE_DISTANCE_PX);
  const closed = isClosedLoop(
    geo,
    nonNegativeOr(options?.closedLoopTolerancePx, STUDIO_ERASE_CLOSED_LOOP_TOLERANCE_PX)
  );
  const outcome = collectCuts(
    geo,
    others,
    tuning,
    closed,
    options?.includeSelfIntersections !== false,
    positiveOr(options?.maxSegmentPairs, STUDIO_ERASE_MAX_SEGMENT_PAIRS),
    mergeDistancePx
  );
  if (!outcome.ok) {
    return { ok: false, reason: "선이 너무 복잡해서 교점을 계산하지 못했어요." };
  }
  const cuts = sortAndMergeCuts(outcome.cuts, mergeDistancePx);
  const attributes = densifyAttributes(target.attributes, geo.pointCount);
  const startParam: StudioStrokeParam = { segmentIndex: 0, t: 0 };
  const endParam: StudioStrokeParam = { segmentIndex: geo.segments.length - 1, t: 1 };

  if (closed && cuts.length >= 1) {
    return planClosedLoopErase(geo, attributes, cuts, hitLocation, startParam, endParam, closed);
  }

  let lowerIndex = -1;
  for (let i = 0; i < cuts.length; i++) {
    if (compareStudioStrokeParams(cuts[i] as StudioStrokeCut, hitLocation) <= 0) lowerIndex = i;
    else break;
  }
  const erasedFrom = lowerIndex >= 0 ? (cuts[lowerIndex] as StudioStrokeCut) : null;
  const erasedTo = lowerIndex + 1 < cuts.length ? (cuts[lowerIndex + 1] as StudioStrokeCut) : null;

  const pieces: StudioStrokePiece[] = [];
  if (erasedFrom) {
    const head = buildPiece(
      geo,
      attributes,
      collectSampleParams(geo, startParam, erasedFrom),
      0,
      erasedFrom.arcLength
    );
    if (head) pieces.push(head);
  }
  if (erasedTo) {
    const tail = buildPiece(
      geo,
      attributes,
      collectSampleParams(geo, erasedTo, endParam),
      erasedTo.arcLength,
      geo.totalLength
    );
    if (tail) pieces.push(tail);
  }

  return {
    ok: true,
    pieces,
    cuts,
    erasedFrom,
    erasedTo,
    erasedLengthPx:
      (erasedTo ? erasedTo.arcLength : geo.totalLength) - (erasedFrom ? erasedFrom.arcLength : 0),
    closedLoop: closed,
    hit: hitLocation,
  };
}

function planClosedLoopErase(
  geo: StrokeGeometry,
  attributes: DenseAttributes,
  cuts: readonly StudioStrokeCut[],
  hitLocation: StudioStrokeHitLocation,
  startParam: StudioStrokeParam,
  endParam: StudioStrokeParam,
  closed: boolean
): StudioEraseToIntersectionResult {
  // 교점이 1개뿐인 닫힌 고리는 그 점에서 출발해 한 바퀴 돌아 같은 점으로 돌아오므로 전부 지워진다.
  if (cuts.length === 1) {
    const only = cuts[0] as StudioStrokeCut;
    return {
      ok: true,
      pieces: [],
      cuts: cuts.slice(),
      erasedFrom: only,
      erasedTo: only,
      erasedLengthPx: geo.totalLength,
      closedLoop: closed,
      hit: hitLocation,
    };
  }
  let lowerIndex = -1;
  for (let i = 0; i < cuts.length; i++) {
    if (compareStudioStrokeParams(cuts[i] as StudioStrokeCut, hitLocation) <= 0) lowerIndex = i;
    else break;
  }
  // 첫 교점보다 앞을 눌렀으면 이음매를 거슬러 마지막 교점이 시작 경계가 된다(순환).
  if (lowerIndex < 0) lowerIndex = cuts.length - 1;
  const erasedFrom = cuts[lowerIndex] as StudioStrokeCut;
  const erasedTo = cuts[(lowerIndex + 1) % cuts.length] as StudioStrokeCut;

  // erasedTo 가 erasedFrom 보다 뒤 → 지워지는 구간은 이음매를 넘지 않고, 남는 조각이 넘는다.
  const survivorWrapsSeam = compareStudioStrokeParams(erasedTo, erasedFrom) > 0;
  let samples: StudioStrokeParam[];
  if (survivorWrapsSeam) {
    // 지워지는 구간이 이음매를 넘지 않는다 → 남는 조각이 이음매를 넘는다.
    const tail = collectSampleParams(geo, erasedTo, endParam);
    const head = collectSampleParams(geo, startParam, erasedFrom);
    samples = tail.concat(head.slice(1)); // 이음매 정점 중복 제거
  } else {
    samples = collectSampleParams(geo, erasedTo, erasedFrom);
  }
  const piece = buildPiece(geo, attributes, samples, erasedTo.arcLength, erasedFrom.arcLength);
  const rawErased = erasedTo.arcLength - erasedFrom.arcLength;
  return {
    ok: true,
    pieces: piece ? [piece] : [],
    cuts: cuts.slice(),
    erasedFrom,
    erasedTo,
    erasedLengthPx: rawErased >= 0 ? rawErased : rawErased + geo.totalLength,
    closedLoop: closed,
    hit: hitLocation,
  };
}

function resolveHitLocation(
  geo: StrokeGeometry,
  hit: StudioErasePoint | StudioStrokeParam
): StudioStrokeHitLocation | null {
  if ("segmentIndex" in hit) {
    if (!Number.isFinite(hit.segmentIndex) || !Number.isFinite(hit.t)) return null;
    if (hit.segmentIndex < 0 || hit.segmentIndex >= geo.segments.length) return null;
    const param = normalizeParam(geo, Math.floor(hit.segmentIndex), hit.t);
    const point = paramPoint(geo, param);
    return {
      ...param,
      x: point.x,
      y: point.y,
      arcLength: paramArcLength(geo, param),
      distancePx: 0,
    };
  }
  if (!Number.isFinite(hit.x) || !Number.isFinite(hit.y)) return null;
  return locateHitOnGeometry(geo, hit);
}

// ---------------------------------------------------------------------------
// 문서 반영 헬퍼
// ---------------------------------------------------------------------------

/**
 * 조각 하나를 DrawEl 패치용 필드 묶음으로 바꾼다 — **없는 속성 키는 아예 넣지 않는다**(patch 에
 * `pressures: undefined` 를 실으면 기존 값을 지워버리는 함정을 막는다).
 */
export function studioStrokePiecePatchFields(
  piece: StudioStrokePiece
): { points: number[] } & StudioStrokePerPointAttributeOutput {
  const fields: { points: number[] } & StudioStrokePerPointAttributeOutput = {
    points: piece.points,
  };
  for (const key of STUDIO_STROKE_PER_POINT_ATTRIBUTE_KEYS) {
    const values = piece.attributes[key];
    if (values) fields[key] = values;
  }
  return fields;
}
