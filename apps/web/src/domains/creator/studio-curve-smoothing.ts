/**
 * Studio Curve Smoothing — 벡터 노드 편집("이동"/"굵기") 세 번째 하위 도구 "스무딩"의 순수 로직
 * 코어.
 *
 * 사용자가 선 위의 한 점(anchor)을 고르면, 그 점 앞뒤로 호길이 반경(NODE_SMOOTH_RADIUS_PX) 안의
 * 인접 점들을 창(window)으로 묶는다. 그 창을 대표하는 축소된 Catmull-Rom 목표 곡선을 한 번
 * 계산한 뒤, 창 안의 모든 점을 "원본 위치 → 목표 곡선 위 대응 위치" 사이에서 강도(strength
 * 0..1)만큼 선형 블렌드한다.
 *
 * 완전한 벡터 펜 도구(앵커+접선 핸들을 직접 드래그해 곡률을 만드는 Illustrator 펜 방식)가
 * 아니라, Illustrator "패스 단순화(Simplify)" 슬라이더에 가까운 사후 스무딩이다 — 사용자가
 * 접선 방향/길이를 직접 지정하지 않는다.
 *
 * studio-node-edit.ts 의 nodeEditPointCount/pointAt 을 그대로 재사용한다(그 파일은 수정하지
 * 않는다). DOM/Konva 의존성 없음 — 캔버스 배선은 호출자(StudioPage)가 담당한다.
 *
 * 핵심 설계 결정(★ 아래 4가지는 유닛 테스트로 고정된 불변식이다 — 되돌리면 회귀):
 *
 * 1. 목표 곡선(target)은 strength 와 무관하게 창 하나당 정확히 한 번만 계산된다. strength 는
 *    원본과 목표 곡선 사이의 선형 블렌드 비율일 뿐이다 — 슬라이더/드래그를 움직이는 동안 모든
 *    점이 완전히 선형(=매끄럽고 단조적)으로 움직인다.
 * 2. 창 경계(lo/hi)는 항상 원래 위치 그대로 고정된다. Catmull-Rom 은 자신의 제어점을 정확히
 *    지나가는 보간 스플라인이고, 제어점 목록에 항상 창의 첫/끝 원본 점을 포함시키므로 파라미터
 *    양 끝에서 목표 곡선이 원본 lo/hi 와 정확히 같아진다 — 스무딩 구간과 창 밖 나머지 스트로크
 *    사이에 꺾임(seam)이 생기지 않는 이유다.
 * 3. 점 개수를 절대 바꾸지 않는다 — 창 안의 점 개수를 그대로 유지한 채 각 점의 (x,y)만 새로
 *    계산해 덮어쓴다. withPressureEdited/decimateStrokeHandles 등 studio-node-edit 의 나머지
 *    코드가 전부 "pointIndex 는 고정 인덱스"라고 가정하기 때문이다.
 * 4. 목표 곡선의 제어점 후보에서 anchor 자신의 원본 좌표는(창 경계가 아닌 한) 항상 제외한다.
 *    창은 anchor 로부터 앞뒤로 대칭에 가깝게 스캔되므로, 균일한 간격의 프리핸드 스트로크에서는
 *    anchor 가 거의 항상 창의 "중앙" 인덱스가 된다. 제어점 개수를 strength 에 따라 줄이는 방식
 *    (초기에 시도했다가 폐기한 설계)에서는 이 중앙 슬롯이 하필 anchor 자신과 정확히 겹치는
 *    경우가 흔해, "사용자가 스무딩하려는 바로 그 점"이 목표 곡선의 제어점이 되어버려 strength 를
 *    아무리 올려도 전혀 안 움직이는 역설이 생긴다(직선 폴리라인 중앙에 y 스파이크 하나를 두고
 *    strength=1 에서 strength=0.2 보다 덜 움직이는 비단조 회귀로 실제 재현됨 — 아래 테스트
 *    "톱니 스파이크..." 참고). anchor 를 후보 풀에서 제외하면 목표 곡선이 그 위치에서 항상
 *    "이웃들이 암시하는" 값을 지나가 anchor 도 다른 점들과 똑같이 단조적으로 움직인다.
 */

import { nodeEditPointCount, pointAt } from "./studio-node-edit";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

export type Point2 = { x: number; y: number };

/** anchor 기준으로 산정된 스무딩 대상 구간 — points 배열의 점 인덱스(양끝 포함, 항상 lo<=hi). */
export type SmoothWindow = {
  lo: number;
  hi: number;
};

export type SmoothPointsOptions = {
  /** 창(window) 호길이 반경(페이지 px) — 기본 NODE_SMOOTH_RADIUS_PX. 주로 테스트에서 창 크기를
   * 결정적으로 좁히는 용도(실 통합에서는 opts 없이 기본값으로 호출된다). */
  radiusPx?: number;
};

/** anchor 앞뒤로 스캔하는 기본 호길이 반경(페이지 px). */
export const NODE_SMOOTH_RADIUS_PX = 60;
/** 창 안 점 개수가 이보다 적으면(스트로크 끝 근처 등) 스무딩을 조용히 생략하고 원본을 반환한다. */
export const NODE_SMOOTH_MIN_WINDOW_POINTS = 5;
/** 목표 곡선 제어점 개수 ≈ 창 점 개수 / 이 값 — "1/divisor 만 살아남는" 솎아내기 비율. */
export const NODE_SMOOTH_KEY_DIVISOR = 4;
/** 제어점 개수 하한(창 경계 2개 + 내부 최소 1개 이상을 보장). */
export const NODE_SMOOTH_MIN_KEY_POINTS = 3;
/** 세로 드래그가 강도 0→1 전 구간에 대응하는 거리(페이지 px) — "굵기" 도구와 동일한 관례. */
export const NODE_SMOOTH_DRAG_RANGE_PX = 160;
/** 패널 슬라이더/드래그 시작 강도 기본값. */
export const NODE_SMOOTH_DEFAULT_STRENGTH = 0.4;

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼 — studio-node-edit.ts 의 동일 패턴(그 파일은 export 하지 않으므로 복제).
// ---------------------------------------------------------------------------

/** 비유한/비양수 값은 fallback 으로 대체하는 양수 위생 처리. */
function sanitizePositive(v: number | undefined, fallback: number): number {
  return Number.isFinite(v) && (v as number) > 0 ? (v as number) : fallback;
}

/** 0..1 로 클램프(비유한은 fallback). */
function clamp01(v: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------------
// Catmull-Rom 스플라인 원시 함수
// ---------------------------------------------------------------------------

/** 스칼라 축 하나에 대한 균일(uniform) Catmull-Rom 3차 보간(x/y 각각에 재사용). */
function catmullRom1D(p0: number, p1: number, p2: number, p3: number, t: number, t2: number, t3: number): number {
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * 균일 Catmull-Rom 4점 3차 보간 — t=0 에서 정확히 p1, t=1 에서 정확히 p2 를 지난다. p0/p3 는
 * 접선 추정용 이웃일 뿐, 곡선이 직접 지나가지는 않는다.
 */
export function catmullRomPoint(p0: Point2, p1: Point2, p2: Point2, p3: Point2, t: number): Point2 {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: catmullRom1D(p0.x, p1.x, p2.x, p3.x, t, t2, t3),
    y: catmullRom1D(p0.y, p1.y, p2.y, p3.y, t, t2, t3),
  };
}

/**
 * 제어점 배열(controlPoints) 위 전체 파라미터 u∈[0, controlPoints.length-1] 평가. 열린(open)/
 * clamped 곡선 — 양 끝 세그먼트는 바깥쪽 이웃이 없으므로 경계점을 복제해 접선을 추정한다(자연
 * 끝 조건). 그 결과 u=0 은 controlPoints[0], u=controlPoints.length-1 은 controlPoints 마지막
 * 원소와 정확히 일치한다.
 *
 * m=0 은 정의역이 없어 원점을 반환하는 방어적 폴백(smoothPointsAroundIndex 는 항상 m>=1 로만
 * 호출하므로 실사용 경로에서는 발생하지 않는다). m=1 은 그 점 자체를 그대로 반환한다.
 */
export function evaluateCatmullRomChain(controlPoints: readonly Point2[], u: number): Point2 {
  const m = controlPoints.length;
  if (m === 0) return { x: 0, y: 0 };
  if (m === 1) return { ...controlPoints[0]! };

  const clamped = u < 0 ? 0 : u > m - 1 ? m - 1 : u;
  let i = Math.floor(clamped);
  if (i > m - 2) i = m - 2;
  const t = clamped - i;

  const p1 = controlPoints[i]!;
  const p2 = controlPoints[i + 1]!;
  const p0 = controlPoints[i - 1] ?? p1;
  const p3 = controlPoints[i + 2] ?? p2;
  return catmullRomPoint(p0, p1, p2, p3, t);
}

// ---------------------------------------------------------------------------
// 창(window) 산정
// ---------------------------------------------------------------------------

/**
 * anchor(pointIndex) 기준 앞뒤로, 누적 호길이가 radiusPx 를 넘지 않는 범위까지 확장한 창을
 * 반환한다. 스트로크 시작/끝 근처에서는 한쪽만 짧게 잘려 비대칭 창이 될 수 있다(정상). 빈
 * points 는 {lo:0, hi:0}. anchorIndex 가 범위 밖이면 points 범위 안으로 클램프해 방어한다.
 */
export function findSmoothWindow(
  points: readonly number[],
  anchorIndex: number,
  radiusPx: number = NODE_SMOOTH_RADIUS_PX
): SmoothWindow {
  const n = nodeEditPointCount(points);
  if (n === 0) return { lo: 0, hi: 0 };

  const anchor = Math.min(Math.max(Math.floor(anchorIndex), 0), n - 1);
  const radius = sanitizePositive(radiusPx, NODE_SMOOTH_RADIUS_PX);

  let lo = anchor;
  let acc = 0;
  while (lo > 0) {
    const a = pointAt(points, lo)!;
    const b = pointAt(points, lo - 1)!;
    const seg = Math.hypot(a.x - b.x, a.y - b.y);
    if (acc + seg > radius) break;
    acc += seg;
    lo--;
  }

  let hi = anchor;
  acc = 0;
  while (hi < n - 1) {
    const a = pointAt(points, hi)!;
    const b = pointAt(points, hi + 1)!;
    const seg = Math.hypot(a.x - b.x, a.y - b.y);
    if (acc + seg > radius) break;
    acc += seg;
    hi++;
  }

  return { lo, hi };
}

// ---------------------------------------------------------------------------
// 목표 곡선 제어점 선정(내부 전용 — 위 §핵심 설계 결정 4)
// ---------------------------------------------------------------------------

/**
 * 창(lo..hi) 안에서 목표 곡선의 제어점으로 쓸 "원본" 인덱스를 고른다(좌표를 새로 계산하는 게
 * 아니라 살아남을 인덱스만 고르는 솎아내기). 항상 lo/hi 를 포함하고, anchorIndex 는(창 경계와
 * 겹치지 않는 한) 후보에서 제외한 뒤 나머지를 균등 간격으로 서브샘플링한다(decimateStrokeHandles
 * 의 step 기반 서브샘플과 동일한 관례). 결과는 항상 오름차순·중복 없음.
 */
function selectControlPointIndices(lo: number, hi: number, anchorIndex: number): number[] {
  if (hi <= lo) return [lo];

  const windowCount = hi - lo + 1;
  const desiredKeyCount = Math.min(
    windowCount,
    Math.max(NODE_SMOOTH_MIN_KEY_POINTS, Math.round(windowCount / NODE_SMOOTH_KEY_DIVISOR))
  );
  const interiorWanted = desiredKeyCount - 2;

  const interiorCandidates: number[] = [];
  for (let i = lo + 1; i < hi; i++) {
    if (i !== anchorIndex) interiorCandidates.push(i);
  }

  if (interiorWanted <= 0 || interiorCandidates.length === 0) {
    return [lo, hi];
  }
  if (interiorWanted >= interiorCandidates.length) {
    return [lo, ...interiorCandidates, hi];
  }

  const picked: number[] = [];
  if (interiorWanted === 1) {
    picked.push(interiorCandidates[Math.round((interiorCandidates.length - 1) / 2)]!);
  } else {
    const step = (interiorCandidates.length - 1) / (interiorWanted - 1);
    for (let k = 0; k < interiorWanted; k++) {
      picked.push(interiorCandidates[Math.round(k * step)]!);
    }
  }
  const dedup = picked.filter((v, idx) => idx === 0 || v !== picked[idx - 1]);
  return [lo, ...dedup, hi];
}

/**
 * idx(창 내부의 원본 인덱스)를 목표 곡선 파라미터 u 로 변환한다 — keyIndices 의 두 인접 원소
 * 사이에서 idx 의 상대 위치를 선형 보간한다(호길이가 아니라 인덱스 비례라 완전한 등호길이
 * 파라미터는 아니지만, "단순화" 목적의 스무딩에는 충분하고 결정적이다). keyIndices[0]=lo,
 * keyIndices.at(-1)=hi 이므로 idx=lo→u=0, idx=hi→u=keyIndices.length-1 이 정확히 보장된다.
 */
function paramForIndex(idx: number, keyIndices: readonly number[]): number {
  const m = keyIndices.length;
  if (m <= 1) return 0;
  for (let k = 0; k < m - 1; k++) {
    const a = keyIndices[k]!;
    const b = keyIndices[k + 1]!;
    if (idx >= a && idx <= b) {
      const span = b - a;
      return span === 0 ? k : k + (idx - a) / span;
    }
  }
  return idx < keyIndices[0]! ? 0 : m - 1;
}

// ---------------------------------------------------------------------------
// 메인 진입점
// ---------------------------------------------------------------------------

/**
 * anchor 주변 창(window)을 목표 Catmull-Rom 곡선 쪽으로 strength(0..1)만큼 블렌드한 **새**
 * points 배열(불변, 길이 항상 원본과 동일 — withPointMoved 등 studio-node-edit 의 나머지
 * 배열 갱신 함수와 동일한 관례).
 *
 * 아래 경우엔 원본과 값이 같은 복사본을 그대로 반환한다(무변화지만 여전히 **새** 배열 참조):
 * - points 가 비어 있음
 * - anchorIndex 가 정수가 아니거나 points 범위 밖(음수 또는 점 개수 이상)
 * - strength 가 0 이하(클램프 후)
 * - 창 안 점 개수가 NODE_SMOOTH_MIN_WINDOW_POINTS 미만(스트로크 끝 근처, 극단적으로 성긴 점 등)
 */
export function smoothPointsAroundIndex(
  points: readonly number[],
  anchorIndex: number,
  strength: number,
  opts?: SmoothPointsOptions
): number[] {
  const out = points.slice();

  const n = nodeEditPointCount(points);
  if (n === 0) return out;
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0 || anchorIndex >= n) return out;

  const s = clamp01(strength, 0);
  if (s <= 0) return out;

  const { lo, hi } = findSmoothWindow(points, anchorIndex, opts?.radiusPx);
  if (hi - lo + 1 < NODE_SMOOTH_MIN_WINDOW_POINTS) return out;

  const keyIndices = selectControlPointIndices(lo, hi, anchorIndex);
  const controlPoints = keyIndices.map((idx) => pointAt(points, idx)!);

  for (let idx = lo; idx <= hi; idx++) {
    const orig = pointAt(points, idx)!;
    const u = paramForIndex(idx, keyIndices);
    const target = evaluateCatmullRomChain(controlPoints, u);
    out[idx * 2] = orig.x + (target.x - orig.x) * s;
    out[idx * 2 + 1] = orig.y + (target.y - orig.y) * s;
  }

  return out;
}

// ---------------------------------------------------------------------------
// 드래그 제스처 → 강도 스칼라
// ---------------------------------------------------------------------------

/**
 * 세로 드래그를 강도 스칼라(0..1)로 변환한다 — "굵기" 도구(updateNodeDragWidth)와 동일한 부호
 * 규약: 위로 끌수록(pointerY < startPointerY) 강도가 커진다. baselineStrength 는 드래그 시작
 * 시점의 강도 스냅샷을 매 틱 다시 기준선으로 삼는다(누적오차 방지 — updateNodeDragWidth 가
 * session.startPressure 를 기준선으로 삼는 것과 동일 패턴).
 */
export function updateSmoothStrengthDrag(
  baselineStrength: number,
  startPointerY: number,
  pointerY: number,
  rangePx: number = NODE_SMOOTH_DRAG_RANGE_PX
): number {
  const range = sanitizePositive(rangePx, NODE_SMOOTH_DRAG_RANGE_PX);
  const baseline = clamp01(baselineStrength, NODE_SMOOTH_DEFAULT_STRENGTH);
  const dy = pointerY - startPointerY;
  return clamp01(baseline - dy / range, baseline);
}
