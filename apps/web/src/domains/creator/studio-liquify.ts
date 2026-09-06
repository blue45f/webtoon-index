/**
 * Studio Liquify — 상용 이미지 편집기의 국소 왜곡 브러시에 대응하는 순수 코어.
 *
 * 개념: 사용자가 브러시로 이미지 위를 드래그하면 그 궤적을 따라 픽셀이 밀리듯 국소적으로
 * 왜곡된다. heal-clone/smudge와 동일하게 **비파괴가 아니다** — 스트로크가 끝나면 실제 픽셀을
 * 재배치해 el.src 자체를 결과 PNG로 교체한다(히스토리 1건, ⌘Z로 원복).
 *
 * 알고리즘(Push / Twirl / Pinch / Bloat):
 *   순수 forward mapping(원본 픽셀을 이동벡터만큼 옮겨 목적지에 쓰기)은 목적지에 구멍(빈 픽셀)이
 *   생긴다. 대신:
 *   1) 스트로크가 누적한 "변위 필드"(각 캔버스 좌표에서 얼마나/어느 방향으로 밀렸는지, dx/dy)를
 *      만든다(buildLiquifyDisplacementField) — 스트로크의 각 세그먼트(리샘플된 이전 점→현재 점)
 *      방향 벡터×강도를, 그 점 중심 반경 내 좌표들에 코사인(Hann) falloff 가중치로 누적한다.
 *      여러 세그먼트가 겹치면 단순 합산(완벽한 유체 시뮬레이션이 아니다 — 겹쳐 문지르면 더 밀린다,
 *      이는 의도된 동작이다).
 *   2) 최종 렌더링은 backward mapping(applyLiquifyDisplacement): 출력 이미지의 각 픽셀 (x,y)에
 *      대해 그 위치의 누적 변위를 역으로 빼서 원본 좌표 (x-dx, y-dy)를 구하고, bilinear 보간
 *      (sampleBilinearClamped)으로 색을 샘플링한다. 구멍 없이 매끈한 결과가 나온다.
 *   변위 필드는 스트로크 궤적의 바운딩박스(±반경)로 한정된 국소 그리드에만 저장한다(전체 캔버스
 *   크기의 dx/dy 배열을 만들지 않는다) — 그 바깥은 변위가 항상 0이므로 결과가 원본과 동일하고,
 *   저장·순회 비용도 스트로크가 실제로 닿은 영역에 비례한다.
 *
 * 3계층 구성은 studio-heal-clone.ts와 동일한 관례를 따른다:
 *   (A) 기하 — 리샘플(균등 간격 재추출), falloff.
 *   (B) 픽셀 알고리즘 — StudioImageDataLike 입출력만 다루는 순수 함수(캔버스 무관, 유닛 테스트 가능).
 *   (C) 캔버스 팩토리 orchestration(bakeLiquifyStrokeToCanvas, Worker 오프로드 포함) —
 *       studio-liquify-browser.ts에 있다(순환 참조 회피, 위 파일 docstring 참고).
 *
 * 좌표 규약: heal-clone(HealCloneDab)/smudge(SmudgePixelPoint)의 선례를 따라 이 모듈도 독립적인
 * "자연 픽셀 좌표" 포인트 타입(LiquifyPixelPoint)을 정의한다(다른 브러시 도구의 타입을 재사용하지
 * 않는다 — 서로 다른 브러시 도구가 우연히 구조가 같다고 묶으면 한쪽만 바뀔 미래 변경에 취약해진다,
 * studio-layer-mask.ts의 동일한 선례 참고). 화면 반전(flipX/flipY)은 이미 되돌려진 상태로 이 모듈에
 * 들어와야 한다 — 호출부(StudioPage)가 flipNormalizedPoint로 되돌린 뒤 자연 해상도로 스케일해서 넘긴다.
 */
import {
  LIQUIFY_MAX_FIELD_CELLS,
  LIQUIFY_MAX_INPUT_POINTS,
  LIQUIFY_MAX_DISPLACEMENT_RADIUS_RATIO,
  normalizeStudioLiquifyMode,
  type StudioLiquifyBrushDynamics,
  type StudioLiquifyMode,
} from "./studio-liquify-contract";

import type { StudioImageDataLike } from "./studio-filters";

export {
  LIQUIFY_RADIUS_DEFAULT,
  LIQUIFY_RADIUS_RANGE,
  LIQUIFY_HARDNESS_DEFAULT,
  LIQUIFY_HARDNESS_RANGE,
  LIQUIFY_MIN_RADIUS_DEFAULT,
  LIQUIFY_MIN_RADIUS_RANGE,
  LIQUIFY_SPACING_DEFAULT,
  LIQUIFY_SPACING_RANGE,
  LIQUIFY_STABILIZER_DEFAULT,
  LIQUIFY_STABILIZER_RANGE,
  LIQUIFY_STRENGTH_DEFAULT,
  LIQUIFY_STRENGTH_RANGE,
  LIQUIFY_MAX_FIELD_CELLS,
  LIQUIFY_MAX_INPUT_POINTS,
  LIQUIFY_MAX_DISPLACEMENT_RADIUS_RATIO,
  STUDIO_LIQUIFY_MODES,
  normalizeStudioLiquifyMode,
  type StudioLiquifyBrushDynamics,
  type StudioLiquifyMode,
} from "./studio-liquify-contract";

// ---------------------------------------------------------------------------
// 타입 · 상수
// ---------------------------------------------------------------------------

/** 픽셀 공간(원본 자연 해상도) 좌표 — SelPoint(정규화 0..1)와는 다른 개념(heal-clone/smudge와 동일 규약). */
export type LiquifyPixelPoint = { x: number; y: number; pressure?: number };

/**
 * Push는 드래그 방향을 사용하고, 나머지 모드는 경로를 일정 간격의 dab으로 바꿔 각 dab 중심에서
 * 회전·수축·팽창 변위를 누적한다. 영속 상태나 외부 입력에서 알 수 없는 값이 들어오면 아래 빌더가
 * 안전하게 Push로 폴백한다.
 */
export type LiquifyDisplacementOptions = StudioLiquifyBrushDynamics & {
  mode?: StudioLiquifyMode;
  /** 긴 동기 계산 전·중단 지점에서 취소를 관찰한다. Worker 경로는 클라이언트가 Worker도 종료한다. */
  signal?: AbortSignal;
};

// 리샘플 간격 = radiusPx * 이 비율(studio-smudge.ts의 SMUDGE_STEP_RATIO와 동일한 정신 — 촘촘할수록
// 부드럽지만 세그먼트 수가 늘어 느려진다). 병적으로 길거나 루프 도는 스트로크 방어 상한도 동일.
const LIQUIFY_STEP_RATIO = 0.35;
export const LIQUIFY_MAX_RESAMPLED_POINTS = 2_000;
/** 병적 장거리/반복 경로가 Worker 한 작업에서 만드는 최대 dab×셀 방문 추정치. */
export const LIQUIFY_MAX_DAB_CELL_VISITS = 96_000_000;
/** 여러 dab이 겹쳐도 한 번의 스트로크가 반경의 두 배보다 멀리 픽셀을 접지 않게 한다. */
const LIQUIFY_MAX_TWIRL_RADIANS = Math.PI / 3;
const LIQUIFY_MAX_RADIAL_SCALE_DELTA = 0.45;

function createLiquifyAbortError(): Error {
  if (typeof DOMException === "function") {
    return new DOMException("리퀴파이 계산을 취소했습니다.", "AbortError");
  }
  const error = new Error("리퀴파이 계산을 취소했습니다.");
  error.name = "AbortError";
  return error;
}

function throwIfLiquifyAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createLiquifyAbortError();
}

function clampInt(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

function clampFloat(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return v < min ? min : v > max ? max : v;
}

// ---------------------------------------------------------------------------
// (A) 기하 — 리샘플 · falloff
// ---------------------------------------------------------------------------

/**
 * 폴리라인을 일정 간격(step, px)으로 리샘플 — studio-smudge.ts의 resampleSmudgePath와 동일 기법
 * (독립 구현 — 위 모듈 docstring 참고). 0/1점 입력은 그대로 반환. 순수, 결정적. 길이 0인(정지된 두
 * 점 사이) 구간은 건너뛴다. 결과는 LIQUIFY_MAX_RESAMPLED_POINTS 개로 상한.
 *
 * 비유한(NaN/Infinity) 좌표를 가진 점은 입력 단계에서 걸러낸다(방어적 — 정상 입력에선 발생하지
 * 않는다) — 그런 점을 그대로 흘려보내면 세그먼트 길이/누적 이월(carried)이 NaN으로 오염되고,
 * 그 NaN이 buildLiquifyDisplacementField 의 가중치 누적 루프로 전파돼(clampInt/clampFloat 가
 * NaN 입력에 자신의 min 인자로 폴백하는 특성과 맞물려) 변위 필드의 한 행/열 전체가 NaN이 되고,
 * 결국 렌더링 시 그 줄 전체가 원본의 (0,0) 픽셀 색으로 잘못 칠해지는 실제 픽셀 손상으로 이어진다
 * (단순 크래시가 아니라 조용한 이미지 오염이라 더 위험하다). 걸러낸 뒤에도 점이 2개 미만이면
 * 그대로 반환(빈 배열 포함) — 호출부(buildLiquifyDisplacementField)의 길이<2 가드가 이어받는다.
 */
export function stabilizeLiquifyPath(
  points: readonly LiquifyPixelPoint[],
  amount: number
): LiquifyPixelPoint[] {
  const safeAmount = clampFloat(amount, 0, 1);
  if (safeAmount <= 0 || points.length < 3) return points.map((point) => ({ ...point }));
  const windowRadius = Math.max(1, Math.round(safeAmount * 4));
  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return { ...point };
    let sumX = 0;
    let sumY = 0;
    let sumPressure = 0;
    let pressureWeight = 0;
    let totalWeight = 0;
    const start = Math.max(0, index - windowRadius);
    const end = Math.min(points.length - 1, index + windowRadius);
    for (let sampleIndex = start; sampleIndex <= end; sampleIndex += 1) {
      const sample = points[sampleIndex]!;
      if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
      const distance = Math.abs(sampleIndex - index);
      const weight = windowRadius + 1 - distance;
      sumX += sample.x * weight;
      sumY += sample.y * weight;
      totalWeight += weight;
      if (Number.isFinite(sample.pressure)) {
        sumPressure += clampFloat(sample.pressure!, 0, 1) * weight;
        pressureWeight += weight;
      }
    }
    if (totalWeight <= 0) return { ...point };
    return {
      x: sumX / totalWeight,
      y: sumY / totalWeight,
      ...(pressureWeight > 0 ? { pressure: sumPressure / pressureWeight } : {}),
    };
  });
}

function interpolatedLiquifyPoint(
  previous: LiquifyPixelPoint,
  current: LiquifyPixelPoint,
  amount: number
): LiquifyPixelPoint {
  const point: LiquifyPixelPoint = {
    x: previous.x + (current.x - previous.x) * amount,
    y: previous.y + (current.y - previous.y) * amount,
  };
  if (previous.pressure !== undefined || current.pressure !== undefined) {
    const start = clampFloat(previous.pressure ?? 1, 0, 1);
    const end = clampFloat(current.pressure ?? 1, 0, 1);
    point.pressure = start + (end - start) * amount;
  }
  return point;
}

export function resampleLiquifyPath(points: readonly LiquifyPixelPoint[], step: number): LiquifyPixelPoint[] {
  const boundedPoints = points.length <= LIQUIFY_MAX_INPUT_POINTS
    ? points
    : Array.from({ length: LIQUIFY_MAX_INPUT_POINTS }, (_, index) => (
        points[Math.round((index * (points.length - 1)) / (LIQUIFY_MAX_INPUT_POINTS - 1))]!
      ));
  const finitePoints =
    boundedPoints.length < 2
    || boundedPoints.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      ? boundedPoints
      : boundedPoints.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (finitePoints.length < 2) return finitePoints.slice();
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;

  const out: LiquifyPixelPoint[] = [finitePoints[0]!];
  let prev = finitePoints[0]!;
  let carried = 0;

  for (let i = 1; i < finitePoints.length; i++) {
    const curr = finitePoints[i]!;
    const segLen = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    if (segLen === 0) continue; // 정지 구간 — 중복점 방지를 위해 건너뛴다(prev 유지).

    let traveled = safeStep - carried;
    while (traveled <= segLen) {
      const t = traveled / segLen;
      out.push(interpolatedLiquifyPoint(prev, curr, t));
      if (out.length >= LIQUIFY_MAX_RESAMPLED_POINTS) return out;
      traveled += safeStep;
    }
    carried = segLen - (traveled - safeStep);
    prev = curr;
  }

  const last = out[out.length - 1]!;
  const finalPt = finitePoints[finitePoints.length - 1]!;
  if ((last.x !== finalPt.x || last.y !== finalPt.y) && out.length < LIQUIFY_MAX_RESAMPLED_POINTS) {
    out.push(finalPt);
  }
  return out;
}

export interface LiquifyBrushDab {
  readonly x: number;
  readonly y: number;
  readonly previousX: number;
  readonly previousY: number;
  readonly radius: number;
  readonly strength: number;
  readonly moveX: number;
  readonly moveY: number;
}

export interface LiquifyBrushDabPlan {
  readonly dabs: readonly LiquifyBrushDab[];
  readonly estimatedCellVisits: number;
  readonly complete: boolean;
}

/** Worker-safe, deterministic sampling contract shared by deformation and field refinement. */
export function planLiquifyBrushDabs(
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  strength: number,
  options: LiquifyDisplacementOptions = {}
): LiquifyBrushDabPlan {
  throwIfLiquifyAborted(options.signal);
  const mode = normalizeStudioLiquifyMode(options.mode);
  const radius = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const baseStrength = clampFloat(strength, 0, 1);
  const minimumPointCount = mode === "push" ? 2 : 1;
  if (
    points.length < minimumPointCount
    || points.length > LIQUIFY_MAX_INPUT_POINTS
    || radius <= 0
    || baseStrength <= 0
  ) {
    return { dabs: [], estimatedCellVisits: 0, complete: points.length <= LIQUIFY_MAX_INPUT_POINTS };
  }

  const stabilizer = clampFloat(options.stabilizer ?? 0, 0, 1);
  const spacingRatio = clampFloat(options.spacingRatio ?? LIQUIFY_STEP_RATIO, 0.1, 0.75);
  const stabilized = stabilizeLiquifyPath(points, stabilizer);
  const resampled = resampleLiquifyPath(stabilized, Math.max(1, radius * spacingRatio));
  if (resampled.length < minimumPointCount) {
    return { dabs: [], estimatedCellVisits: 0, complete: true };
  }
  const finalInput = stabilized.at(-1);
  const finalSample = resampled.at(-1);
  const complete = Boolean(
    finalInput
    && finalSample
    && finalInput.x === finalSample.x
    && finalInput.y === finalSample.y
  );
  if (!complete) return { dabs: [], estimatedCellVisits: 0, complete: false };

  const minimumRadiusRatio = clampFloat(options.minimumRadiusRatio ?? 0, 0, 1);
  const dabs: LiquifyBrushDab[] = [];
  let estimatedCellVisits = 0;
  const startIndex = mode === "push" ? 1 : 0;
  for (let index = startIndex; index < resampled.length; index += 1) {
    if ((index & 31) === 0) throwIfLiquifyAborted(options.signal);
    const point = resampled[index]!;
    const previous = mode === "push" ? resampled[index - 1]! : point;
    const pressure = clampFloat(point.pressure ?? 1, 0, 1);
    const radiusScale = options.pressureAffectsRadius
      ? minimumRadiusRatio + (1 - minimumRadiusRatio) * pressure
      : 1;
    const dabRadius = radius * radiusScale;
    const dabStrength = baseStrength * (options.pressureAffectsStrength ? pressure : 1);
    if (dabRadius <= 0 || dabStrength <= 0) continue;
    const diameterCells = Math.ceil(dabRadius) * 2 + 1;
    estimatedCellVisits += diameterCells * diameterCells;
    if (
      !Number.isSafeInteger(estimatedCellVisits)
      || estimatedCellVisits > LIQUIFY_MAX_DAB_CELL_VISITS
    ) {
      return { dabs: [], estimatedCellVisits, complete: false };
    }
    dabs.push({
      x: point.x,
      y: point.y,
      previousX: previous.x,
      previousY: previous.y,
      radius: dabRadius,
      strength: dabStrength,
      moveX: mode === "push" ? (point.x - previous.x) * dabStrength : 0,
      moveY: mode === "push" ? (point.y - previous.y) * dabStrength : 0,
    });
  }
  return { dabs, estimatedCellVisits, complete };
}

/**
 * 브러시 중심에서 (dx,dy) 만큼 떨어진 지점의 변위 가중치(0..1) — 코사인(Hann window) falloff.
 * t=dist/radius 일 때 0.5*(1+cos(π·t)): 중심(t=0)에서 1, 가장자리(t=1)에서 0으로 매끈하게 줄어들고
 * 양쪽 끝 모두 미분이 0이라(피크·경계 둘 다 완만) smudgeBrushWeight의 t² 근사보다 경계가 더 부드럽다
 * — "가우시안/코사인 falloff" 요구사항을 코사인 쪽으로 구현한 것(가우시안은 이론상 반경 밖에서도
 * 완전히 0이 되지 않아 필드 바운딩박스 경계에서 미세한 불연속이 남을 수 있어 제외했다). radiusPx
 * 이상이면 0. 순수.
 */
export function liquifyBrushWeight(
  dx: number,
  dy: number,
  radiusPx: number,
  hardness?: number
): number {
  const r = Number.isFinite(radiusPx) && radiusPx > 0 ? radiusPx : 0;
  if (r <= 0) return 0;
  // dab 루프의 픽셀마다 호출되는 경로 — Math.hypot 대신 제곱거리 컷 + sqrt 한 번.
  const dist2 = dx * dx + dy * dy;
  if (dist2 >= r * r) return 0;
  const dist = Math.sqrt(dist2);
  const t = dist / r;
  if (hardness === undefined) return 0.5 * (1 + Math.cos(Math.PI * t));
  const hardCore = clampFloat(hardness, 0, 1) * 0.8;
  if (t <= hardCore) return 1;
  const feather = (t - hardCore) / Math.max(1e-6, 1 - hardCore);
  return 0.5 * (1 + Math.cos(Math.PI * feather));
}

// ---------------------------------------------------------------------------
// (B) 픽셀 알고리즘 — 변위 필드 누적 + backward mapping 렌더
// ---------------------------------------------------------------------------

/**
 * 스트로크가 누적한 변위 필드 — 캔버스 전체가 아니라 스트로크 바운딩박스(±반경)로 한정된 국소
 * 그리드다. (originX,originY)가 필드 로컬 (0,0)에 대응하는 캔버스 좌표. dx/dy[y*width+x] = 그
 * 캔버스 좌표(originX+x, originY+y)에서 누적된 변위(px, 방향 포함). 필드 밖은 항상 변위 0.
 */
export type LiquifyDisplacementField = {
  originX: number;
  originY: number;
  width: number;
  height: number;
  dx: Float32Array;
  dy: Float32Array;
};

/**
 * src/dst가 전체 이미지가 아닌 동일한 부분 픽셀 버퍼일 때의 전역 좌표 계약. field와 stroke는
 * 계속 전체 canvas 좌표를 사용한다. 이 좌표계를 보존해야 ROI 실행도 전체 프레임 실행과 동일한
 * 전역 경계 clamp 및 부동소수점 bilinear 샘플 위치를 갖는다.
 */
export type LiquifyImageRegion = {
  readonly originX: number;
  readonly originY: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
};

/**
 * 스트로크 궤적 → 변위 필드. Push는 points.length<2(방향을 정할 수 없음), 그 외 모드는
 * points.length<1, radiusPx<=0, strength<=0 또는 캔버스 크기가 비정상이면 null이다.
 *
 * @param strength 0..1 (호출부가 %/100로 변환해서 넘긴다, smudge 관례와 동일).
 * @param canvasW/canvasH 원본(자연) 픽셀 크기 — 필드 바운딩박스를 이 안으로 클램프한다.
 *
 * 알고리즘: resampleLiquifyPath로 균등 간격 점을 얻은 뒤, 연속한 두 점(prev→curr)마다:
 *   세그먼트 방향 벡터 (curr-prev)×strength 를, curr 중심 반경 radiusPx 원 내부의 각 필드 셀에
 *   liquifyBrushWeight 가중치로 더한다(단순 합산 — 여러 세그먼트가 겹치면 그만큼 더 밀린다).
 * 필드 바운딩박스는 리샘플된 모든 점의 최소/최대 좌표에 ⌈radiusPx⌉를 더 확장한 사각형이다 —
 * 이 경계에서는 어느 점에서 봐도 dist>=radius라 가중치가 이미 0이므로(위 liquifyBrushWeight가
 * 경계에서 정확히 0으로 수렴) 필드 경계에서 시각적 이음매(seam)가 생기지 않는다.
 */
export function buildLiquifyDisplacementField(
  points: readonly LiquifyPixelPoint[],
  radiusPx: number,
  strength: number,
  canvasW: number,
  canvasH: number,
  options: LiquifyDisplacementOptions = {}
): LiquifyDisplacementField | null {
  throwIfLiquifyAborted(options.signal);
  const mode = normalizeStudioLiquifyMode(options.mode);
  const R = Number.isFinite(radiusPx) ? Math.max(0, radiusPx) : 0;
  const s = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  const w = Number.isFinite(canvasW) ? Math.max(0, Math.round(canvasW)) : 0;
  const h = Number.isFinite(canvasH) ? Math.max(0, Math.round(canvasH)) : 0;
  const minimumPointCount = mode === "push" ? 2 : 1;
  if (points.length < minimumPointCount || R <= 0 || s <= 0 || w <= 0 || h <= 0) return null;

  const plan = planLiquifyBrushDabs(points, R, s, options);
  if (!plan.complete || plan.dabs.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const dab of plan.dabs) {
    if (dab.x - dab.radius < minX) minX = dab.x - dab.radius;
    if (dab.y - dab.radius < minY) minY = dab.y - dab.radius;
    if (dab.x + dab.radius > maxX) maxX = dab.x + dab.radius;
    if (dab.y + dab.radius > maxY) maxY = dab.y + dab.radius;
    if (mode === "push") {
      if (dab.previousX - dab.radius < minX) minX = dab.previousX - dab.radius;
      if (dab.previousY - dab.radius < minY) minY = dab.previousY - dab.radius;
      if (dab.previousX + dab.radius > maxX) maxX = dab.previousX + dab.radius;
      if (dab.previousY + dab.radius > maxY) maxY = dab.previousY + dab.radius;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null; // 방어적 — 정상 입력에선 발생하지 않는다(모든 점이 비유한일 때만).
  }

  const originX = clampInt(Math.floor(minX), 0, w - 1);
  const originY = clampInt(Math.floor(minY), 0, h - 1);
  const endX = clampInt(Math.ceil(maxX), 0, w - 1);
  const endY = clampInt(Math.ceil(maxY), 0, h - 1);
  if (endX < originX || endY < originY) return null;

  const fieldW = endX - originX + 1;
  const fieldH = endY - originY + 1;
  if (
    !Number.isSafeInteger(fieldW) ||
    !Number.isSafeInteger(fieldH) ||
    fieldW <= 0 ||
    fieldH <= 0 ||
    fieldW > LIQUIFY_MAX_FIELD_CELLS / fieldH
  ) {
    return null;
  }

  const fieldCells = fieldW * fieldH;
  let dx: Float32Array;
  let dy: Float32Array;
  try {
    dx = new Float32Array(fieldCells);
    dy = new Float32Array(fieldCells);
  } catch {
    return null;
  }

  const maximumDisplacement = Math.max(1, R * LIQUIFY_MAX_DISPLACEMENT_RADIUS_RATIO);
  const accumulate = (idx: number, addX: number, addY: number): void => {
    if (!Number.isFinite(addX) || !Number.isFinite(addY)) return;
    let nextX = dx[idx]! + addX;
    let nextY = dy[idx]! + addY;
    const magnitude = Math.hypot(nextX, nextY);
    if (magnitude > maximumDisplacement) {
      const scale = maximumDisplacement / magnitude;
      nextX *= scale;
      nextY *= scale;
    }
    dx[idx] = nextX;
    dy[idx] = nextY;
  };

  const hardness = options.hardness === undefined
    ? undefined
    : clampFloat(options.hardness, 0, 1);
  for (let i = 0; i < plan.dabs.length; i += 1) {
    if ((i & 15) === 0) throwIfLiquifyAborted(options.signal);
    const curr = plan.dabs[i]!;
    const segX = curr.moveX;
    const segY = curr.moveY;
    if (mode === "push" && segX === 0 && segY === 0) continue;

    const localRadius = Math.ceil(curr.radius);
    const minLocalX = clampInt(Math.floor(curr.x - localRadius), originX, endX);
    const maxLocalX = clampInt(Math.ceil(curr.x + localRadius), originX, endX);
    const minLocalY = clampInt(Math.floor(curr.y - localRadius), originY, endY);
    const maxLocalY = clampInt(Math.ceil(curr.y + localRadius), originY, endY);

    for (let y = minLocalY; y <= maxLocalY; y += 1) {
      if (((y - minLocalY) & 31) === 0) throwIfLiquifyAborted(options.signal);
      const rowOffset = (y - originY) * fieldW;
      for (let x = minLocalX; x <= maxLocalX; x += 1) {
        const offsetX = x - curr.x;
        const offsetY = y - curr.y;
        const weight = liquifyBrushWeight(offsetX, offsetY, curr.radius, hardness);
        if (weight <= 0) continue;
        const idx = rowOffset + (x - originX);
        if (mode === "push") {
          accumulate(idx, segX * weight, segY * weight);
          continue;
        }

        if (mode === "twirl-clockwise" || mode === "twirl-counterclockwise") {
          // 화면 좌표계는 +y가 아래라 양의 각도가 시계 방향이다.
          const direction = mode === "twirl-clockwise" ? 1 : -1;
          const angle = direction * LIQUIFY_MAX_TWIRL_RADIANS * curr.strength * weight;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const rotatedX = offsetX * cos - offsetY * sin;
          const rotatedY = offsetX * sin + offsetY * cos;
          accumulate(idx, rotatedX - offsetX, rotatedY - offsetY);
          continue;
        }

        const direction = mode === "bloat" ? 1 : -1;
        const scaleDelta = direction * LIQUIFY_MAX_RADIAL_SCALE_DELTA * curr.strength * weight;
        accumulate(idx, offsetX * scaleDelta, offsetY * scaleDelta);
      }
    }
  }

  return { originX, originY, width: fieldW, height: fieldH, dx, dy };
}

/**
 * 이미지의 (x,y) 지점 색을 bilinear 보간으로 샘플링 — 좌표가 이미지 밖이면 클램프-투-엣지(경계
 * 픽셀을 반복, smudgeStroke의 소스 샘플링과 동일 정책). w/h<=0 이면 [0,0,0,0]. 순수.
 */
export function sampleBilinearClamped(
  img: StudioImageDataLike,
  x: number,
  y: number
): [number, number, number, number] {
  const w = img.width;
  const h = img.height;
  if (w <= 0 || h <= 0) return [0, 0, 0, 0];

  const sx = clampFloat(x, 0, w - 1);
  const sy = clampFloat(y, 0, h - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;

  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;

  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c += 1) {
    const top = img.data[i00 + c]! + (img.data[i10 + c]! - img.data[i00 + c]!) * tx;
    const bottom = img.data[i01 + c]! + (img.data[i11 + c]! - img.data[i01 + c]!) * tx;
    out[c] = top + (bottom - top) * ty;
  }
  return out;
}

function sampleBilinearClampedFromRegion(
  img: StudioImageDataLike,
  globalX: number,
  globalY: number,
  region: LiquifyImageRegion,
): [number, number, number, number] {
  if (img.width <= 0 || img.height <= 0) return [0, 0, 0, 0];
  const sx = clampFloat(globalX, 0, region.canvasWidth - 1);
  const sy = clampFloat(globalY, 0, region.canvasHeight - 1);
  const globalX0 = Math.floor(sx);
  const globalY0 = Math.floor(sy);
  const globalX1 = Math.min(region.canvasWidth - 1, globalX0 + 1);
  const globalY1 = Math.min(region.canvasHeight - 1, globalY0 + 1);
  const x0 = clampInt(globalX0 - region.originX, 0, img.width - 1);
  const y0 = clampInt(globalY0 - region.originY, 0, img.height - 1);
  const x1 = clampInt(globalX1 - region.originX, 0, img.width - 1);
  const y1 = clampInt(globalY1 - region.originY, 0, img.height - 1);
  const tx = sx - globalX0;
  const ty = sy - globalY0;
  const i00 = (y0 * img.width + x0) * 4;
  const i10 = (y0 * img.width + x1) * 4;
  const i01 = (y1 * img.width + x0) * 4;
  const i11 = (y1 * img.width + x1) * 4;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let channel = 0; channel < 4; channel += 1) {
    const top = img.data[i00 + channel]!
      + (img.data[i10 + channel]! - img.data[i00 + channel]!) * tx;
    const bottom = img.data[i01 + channel]!
      + (img.data[i11 + channel]! - img.data[i01 + channel]!) * tx;
    out[channel] = top + (bottom - top) * ty;
  }
  return out;
}

/**
 * 변위 필드를 backward mapping으로 렌더 — dst의 각 필드 셀 (x,y)에 대해 src의 (x-dx, y-dy)를
 * bilinear 샘플링해 덮어쓴다. 호출 전 dst는 이미 src와 동일한 픽셀(원본 그대로)로 초기화돼 있어야
 * 한다(bakeLiquifyStrokeToCanvas가 이를 보장) — 변위가 정확히 (0,0)인 셀은 건너뛴다(불필요한 재샘플
 * 방지, 결과는 이미 dst에 있는 원본 픽셀과 동일하므로 스킵해도 무손실).
 * src와 dst는 반드시 서로 다른 버퍼여야 한다(heal-clone의 frozen/work 분리와 동일한 이유 — 같은
 * 버퍼를 쓰면 이미 옮겨 쓴 픽셀을 다른 셀이 다시 원본인 양 읽어버려 스캔 순서에 따라 결과가
 * 달라지는 이중 왜곡이 생긴다).
 */
export function applyLiquifyDisplacement(
  src: StudioImageDataLike,
  dst: StudioImageDataLike,
  field: LiquifyDisplacementField,
  options: Pick<LiquifyDisplacementOptions, "signal"> & {
    readonly region?: LiquifyImageRegion;
  } = {}
): void {
  throwIfLiquifyAborted(options.signal);
  const region = options.region;
  const originX = region?.originX ?? 0;
  const originY = region?.originY ?? 0;
  const w = region?.canvasWidth ?? dst.width;
  const h = region?.canvasHeight ?? dst.height;
  const regionEndX = originX + dst.width;
  const regionEndY = originY + dst.height;
  const fieldWidth = Number.isSafeInteger(field.width) && field.width > 0 ? field.width : 0;
  const fieldHeight = Number.isSafeInteger(field.height) && field.height > 0 ? field.height : 0;
  const expectedCells = fieldWidth * fieldHeight;
  if (
    !Number.isFinite(field.originX) ||
    !Number.isFinite(field.originY) ||
    fieldWidth === 0 ||
    fieldHeight === 0 ||
    !Number.isSafeInteger(expectedCells) ||
    expectedCells > LIQUIFY_MAX_FIELD_CELLS ||
    field.dx.length < expectedCells ||
    field.dy.length < expectedCells
  ) {
    return;
  }
  for (let ly = 0; ly < fieldHeight; ly += 1) {
    if ((ly & 31) === 0) throwIfLiquifyAborted(options.signal);
    const y = field.originY + ly;
    if (y < 0 || y >= h) continue;
    const rowOffset = ly * fieldWidth;
    for (let lx = 0; lx < fieldWidth; lx += 1) {
      const x = field.originX + lx;
      if (x < 0 || x >= w) continue;
      if (x < originX || x >= regionEndX || y < originY || y >= regionEndY) continue;
      const idx = rowOffset + lx;
      const ddx = field.dx[idx]!;
      const ddy = field.dy[idx]!;
      if (!Number.isFinite(ddx) || !Number.isFinite(ddy) || (ddx === 0 && ddy === 0)) continue;
      const [r, g, b, a] = region
        ? sampleBilinearClampedFromRegion(src, x - ddx, y - ddy, region)
        : sampleBilinearClamped(src, x - ddx, y - ddy);
      const dstIdx = ((y - originY) * dst.width + (x - originX)) * 4;
      dst.data[dstIdx] = r;
      dst.data[dstIdx + 1] = g;
      dst.data[dstIdx + 2] = b;
      dst.data[dstIdx + 3] = a;
    }
  }
}

// (C) 캔버스 팩토리 orchestration(bakeLiquifyStrokeToCanvas)은 studio-liquify-browser.ts로
// 옮겼다 — 무거운 변위 적용을 Worker로 오프로드하려면 그 워커 클라이언트가 이 파일의
// applyLiquifyDisplacement를 폴백용으로 import해야 하는데, 이 파일이 오케스트레이션 함수를 통해
// 다시 워커 클라이언트를 import하면 순환 참조가 된다(studio-magic-wand.ts/
// studio-magic-wand-browser.ts와 동일한 분리 이유).
