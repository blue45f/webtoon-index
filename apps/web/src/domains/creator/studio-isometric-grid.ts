/**
 * Studio Isometric Grid — 아이소메트릭 원근 그리드 순수 기하 모듈.
 *
 * studio-perspective-guide.ts(소실점 스냅)와 데이터 모델이 근본적으로 다르다: 소실점은
 * 선이 "수렴"하는 점이지만, 아이소메트릭 그리드는 3개의 고정 각도(angleDeg, 180-angleDeg,
 * 90°)를 향해 뻗는 "평행" 선 다발이다 — 그래서 별도 모듈로 분리했다. 다만 아키텍처는
 * 의도적으로 그대로 미러링한다: Konva/DOM/React 무의존 순수 함수 + 타입만 export,
 * resolveXRay → projectPointOntoX → snapStrokePointToX 3단 패턴으로 스트로크 시작점에서
 * 방향을 한 번 확정(lock)하고 이후 포인트를 그 방향의 무한 직선 위로 투영한다.
 *
 * 좌표계: 호출부가 주는 좌표계(레이어 좌표) 그대로. 화면 픽셀 기준 드래그 임계를 원하면
 * ISOMETRIC_LOCK_MIN_DRAG 를 effScale 로 나눠 넘기면 된다(원근자/스마트가이드와 동일 관례).
 *
 * 참고: resolveIsometricAxisRay 가 돌려주는 ray 의 원점은 (원근자와 마찬가지로) 스트로크
 * 시작점이지, 그리드 선 자체가 아니다 — 이 모듈은 "방향 잠금"만 하고, 시작점을 그리드
 * 교차점으로 스냅하지는 않는다(원근자 컨트랙트와 동일하게 의도적).
 */

export interface IsometricGridConfig {
  angleDeg: number;
  cellSize: number;
  originX: number;
  originY: number;
}

/** 그리드가 그리는 평행선 다발 하나(무한 직선을 캔버스 안에서 표현하는 선분). */
export interface IsometricGridLine {
  axisIndex: 0 | 1 | 2;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 스트로크 하나 동안 고정되는(락 걸리는) 아이소메트릭 축 방향 직선. */
export interface IsometricAxisRay {
  axisIndex: 0 | 1 | 2;
  originX: number;
  originY: number;
  /** 정규화된 방향 벡터(단위 벡터). 부호는 의미 없음 — 투영은 직선 전체를 대상으로 한다. */
  dirX: number;
  dirY: number;
}

/** 축 하나당 렌더링할 평행선 최대 개수 — cellSize 가 매우 작을 때 성능 안전장치. */
export const MAX_LINES_PER_AXIS = 160;

/**
 * 방향 확정 전 최소 드래그 거리(px, 1배율 기준) — 원근자의 PERSPECTIVE_LOCK_MIN_DRAG 와
 * 동일한 역할/값. 화면 픽셀 기준으로 쓰려면 effScale 로 나눠서 호출부가 넘긴다.
 */
export const ISOMETRIC_LOCK_MIN_DRAG = 4;

export const DEFAULT_ISOMETRIC_ANGLE_DEG = 30;
export const DEFAULT_ISOMETRIC_CELL_SIZE = 40;

/** 각도 슬라이더 프리셋 — 0°/90° 는 축 3개 중 2개가 겹치는 퇴화 케이스라 제외한다. */
export const ISOMETRIC_ANGLE_PRESETS_DEG: readonly number[] = [15, 30, 45, 60];

/** 각도 입력 허용 범위 — 양끝(0/90)은 퇴화 케이스라 열린 구간처럼 1도씩 안쪽으로 클램프한다. */
export const ISOMETRIC_ANGLE_MIN_DEG = 1;
export const ISOMETRIC_ANGLE_MAX_DEG = 89;

export const ISOMETRIC_CELL_SIZE_MIN = 8;
export const ISOMETRIC_CELL_SIZE_MAX = 200;

/**
 * Isometric visibility and stroke constraint are separate concerns.
 *
 * Freehand brushes use the grid as a visual hint only. Projecting their sampled points onto an
 * axis turns a smooth curve into a straight/angular stroke as soon as the hint becomes active.
 * Only the explicit line tool opts into axis locking.
 */
export function shouldSnapStrokeToIsometricAxis(input: {
  readonly active: boolean;
  readonly mode?: string;
  readonly kind?: string;
}): boolean {
  return input.active && input.mode !== "eraser" && input.kind === "line";
}

function isFiniteNumber(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

// ---------------------------------------------------------------------------
// 1) 설정 헬퍼 — 기본값/클램프/축 각도 계산. 전부 순수 함수.
// ---------------------------------------------------------------------------

/**
 * 각도(angleDeg) 하나로부터 3개의 고정 축 각도를 계산한다: 입력 각도, 그 수직축(90°)을
 * 기준으로 대칭인 각도(180-angleDeg), 그리고 항상 수직(90°). 예: angleDeg=30 이면
 * [30, 150, 90] — 표준 아이소메트릭(좌우 30° + 수직)이 된다.
 */
export function isometricAxisAngles(angleDeg: number): [number, number, number] {
  return [angleDeg, 180 - angleDeg, 90];
}

/** angleDeg 를 [ISOMETRIC_ANGLE_MIN_DEG, ISOMETRIC_ANGLE_MAX_DEG] 범위로 클램프한다. NaN/Infinity 는 기본값으로. */
export function clampIsometricAngleDeg(angleDeg: number): number {
  if (!isFiniteNumber(angleDeg)) return DEFAULT_ISOMETRIC_ANGLE_DEG;
  return Math.min(ISOMETRIC_ANGLE_MAX_DEG, Math.max(ISOMETRIC_ANGLE_MIN_DEG, angleDeg));
}

/** cellSize 를 [ISOMETRIC_CELL_SIZE_MIN, ISOMETRIC_CELL_SIZE_MAX] 범위로 클램프한다. NaN/Infinity 는 기본값으로. */
export function clampIsometricCellSize(cellSize: number): number {
  if (!isFiniteNumber(cellSize)) return DEFAULT_ISOMETRIC_CELL_SIZE;
  return Math.min(ISOMETRIC_CELL_SIZE_MAX, Math.max(ISOMETRIC_CELL_SIZE_MIN, cellSize));
}

/** 그리드를 처음 켤 때의 기본 기준점(origin) — 캔버스 정중앙. */
export function defaultIsometricOrigin(canvasWidth: number, canvasHeight: number): { x: number; y: number } {
  return { x: canvasWidth / 2, y: canvasHeight / 2 };
}

// ---------------------------------------------------------------------------
// 2) 오버레이 — 3개 축 방향으로 캔버스를 덮는 평행선 다발 좌표 계산.
// ---------------------------------------------------------------------------

/**
 * 아이소메트릭 그리드의 평행선 다발을 계산한다. 각 축(angleDeg, 180-angleDeg, 90°)마다
 * cellSize 간격으로 캔버스를 완전히 덮는 평행선들을 만든다 — origin 을 지나는 선이 항상
 * 그 축의 기준선(offset=0)이 된다.
 *
 * canvasWidth/canvasHeight<=0, cellSize<=0, 또는 origin/angleDeg 가 NaN/Infinity 면 [].
 * cellSize 가 매우 작아 한 축의 필요 선 개수가 MAX_LINES_PER_AXIS 를 넘으면, 캔버스를
 * 덮는 데 필요한 오프셋 범위의 중앙을 기준으로 그 개수만큼만 잘라 돌려준다(성능 안전장치).
 */
export function isometricGridLines(
  config: IsometricGridConfig,
  canvasWidth: number,
  canvasHeight: number
): IsometricGridLine[] {
  const { angleDeg, cellSize, originX, originY } = config;
  if (canvasWidth <= 0 || canvasHeight <= 0) return [];
  if (!isFiniteNumber(cellSize) || cellSize <= 0) return [];
  if (!isFiniteNumber(originX) || !isFiniteNumber(originY)) return [];

  const angles = isometricAxisAngles(angleDeg);
  if (angles.some((a) => !isFiniteNumber(a))) return [];

  const corners: Array<[number, number]> = [
    [0, 0],
    [canvasWidth, 0],
    [0, canvasHeight],
    [canvasWidth, canvasHeight],
  ];
  const margin = Math.max(canvasWidth, canvasHeight) * 0.25;

  const lines: IsometricGridLine[] = [];

  angles.forEach((angleForAxis, axisIndexRaw) => {
    const axisIndex = axisIndexRaw as 0 | 1 | 2;
    const rad = (angleForAxis * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // 방향(dx,dy)에 수직인 단위 벡터 — 평행선들을 이 방향으로 cellSize 씩 밀어 배치한다.
    const nx = -dy;
    const ny = dx;

    let minOffset = Infinity;
    let maxOffset = -Infinity;
    let maxAbsT = 0;
    for (const [cx, cy] of corners) {
      const relX = cx - originX;
      const relY = cy - originY;
      const offset = relX * nx + relY * ny; // origin 기준 수직축 성분(어느 평행선에 속하는지).
      const t = relX * dx + relY * dy; // origin 기준 축 방향 성분(선을 얼마나 늘려야 하는지).
      if (offset < minOffset) minOffset = offset;
      if (offset > maxOffset) maxOffset = offset;
      if (Math.abs(t) > maxAbsT) maxAbsT = Math.abs(t);
    }
    // n ⊥ d 이므로 (ox,oy)=origin+k*cellSize*n 로 이동해도 t 투영값은 k 와 무관하게 동일하다
    // — 그래서 halfLen 은 축당 한 번만 계산하면 모든 k(모든 평행선)에 대해 그대로 유효하다.
    const halfLen = maxAbsT + margin;

    let start = Math.floor(minOffset / cellSize);
    let end = Math.ceil(maxOffset / cellSize);
    if (end - start + 1 > MAX_LINES_PER_AXIS) {
      const mid = Math.round((start + end) / 2);
      const half = Math.floor(MAX_LINES_PER_AXIS / 2);
      start = mid - half;
      end = start + MAX_LINES_PER_AXIS - 1;
    }

    for (let k = start; k <= end; k++) {
      const ox = originX + k * cellSize * nx;
      const oy = originY + k * cellSize * ny;
      lines.push({
        axisIndex,
        x1: ox - halfLen * dx,
        y1: oy - halfLen * dy,
        x2: ox + halfLen * dx,
        y2: oy + halfLen * dy,
      });
    }
  });

  return lines;
}

// ---------------------------------------------------------------------------
// 3) 스트로크 스냅 — 시작점에서의 드래그 방향과 가장 가까운 고정 축을 골라 그 방향의
//    직선(ray)을 확정하고, 이후 들어오는 포인트를 그 직선 위로 투영한다.
// ---------------------------------------------------------------------------

/**
 * 스트로크 시작점(startX,startY)에서 현재 드래그 지점(dragX,dragY)까지의 방향과 가장
 * 가까운(각도 차가 가장 작은) 고정 축(angleDeg, 180-angleDeg, 90° 중 하나)을 골라 그
 * 방향의 직선을 확정한다. resolvePerspectiveRay 와 동일한 컨트랙트:
 *
 * - 시작점에서 드래그 지점까지 거리가 minDragDist 미만이면 아직 방향을 판단할 수 없으므로
 *   null(호출부는 다음 move 이벤트마다 다시 호출해 null 이 아닐 때 캐시한다).
 * - "가장 가까운"은 단위 벡터 내적의 절대값이 가장 큰(=각도 차가 가장 작은) 축 — 직선은
 *   양방향이라 부호는 무시한다(±180° 는 같은 직선). 동률이면 먼저 나온 축(angleDeg 원본,
 *   그다음 180-angleDeg, 마지막 90°)이 이긴다.
 * - 시작점/드래그 지점 좌표가 NaN/Infinity 면 null, throw 하지 않는다.
 * - angleDeg 가 NaN/Infinity 면 그 값에서 파생되는 두 대각선 축(인덱스 0, 1)만 후보에서
 *   빠진다 — 세 번째 축(인덱스 2)은 isometricAxisAngles 공식상 항상 상수 90°라 angleDeg
 *   와 무관하게 유효하므로, 유일한 후보로 남아 그 방향으로 락 걸린다(null 이 되지 않는다).
 */
export function resolveIsometricAxisRay(
  angleDeg: number,
  startX: number,
  startY: number,
  dragX: number,
  dragY: number,
  options: { minDragDist?: number } = {}
): IsometricAxisRay | null {
  const minDragDist = options.minDragDist ?? ISOMETRIC_LOCK_MIN_DRAG;
  if (
    !isFiniteNumber(startX) ||
    !isFiniteNumber(startY) ||
    !isFiniteNumber(dragX) ||
    !isFiniteNumber(dragY)
  ) {
    return null;
  }

  const dx = dragX - startX;
  const dy = dragY - startY;
  const dragDist = Math.hypot(dx, dy);
  if (dragDist < minDragDist) return null;
  const ux = dx / dragDist;
  const uy = dy / dragDist;

  const angles = isometricAxisAngles(angleDeg);

  let bestIndex = -1;
  let bestDirX = 0;
  let bestDirY = 0;
  let bestAbsDot = -1;

  angles.forEach((angleForAxis, indexRaw) => {
    if (!isFiniteNumber(angleForAxis)) return;
    const rad = (angleForAxis * Math.PI) / 180;
    const axDx = Math.cos(rad);
    const axDy = Math.sin(rad);
    const absDot = Math.abs(ux * axDx + uy * axDy);
    if (absDot > bestAbsDot) {
      bestAbsDot = absDot;
      bestIndex = indexRaw;
      bestDirX = axDx;
      bestDirY = axDy;
    }
  });

  if (bestIndex === -1) return null;
  return {
    axisIndex: bestIndex as 0 | 1 | 2,
    originX: startX,
    originY: startY,
    dirX: bestDirX,
    dirY: bestDirY,
  };
}

/** 점(px,py)을 ray 가 나타내는 무한 직선 위로 수직 투영한다. */
export function projectPointOntoIsometricAxis(px: number, py: number, ray: IsometricAxisRay): [number, number] {
  const t = (px - ray.originX) * ray.dirX + (py - ray.originY) * ray.dirY;
  return [ray.originX + t * ray.dirX, ray.originY + t * ray.dirY];
}

/**
 * 스트로크 포인트 파이프라인용 원스텝 헬퍼 — ray 가 null 이면(그리드 꺼짐/방향 미확정)
 * 입력을 그대로 돌려주므로, 호출부는 항상 안전하게 호출할 수 있다.
 */
export function snapStrokePointToIsometricGrid(
  px: number,
  py: number,
  ray: IsometricAxisRay | null
): [number, number] {
  if (!ray) return [px, py];
  return projectPointOntoIsometricAxis(px, py, ray);
}
