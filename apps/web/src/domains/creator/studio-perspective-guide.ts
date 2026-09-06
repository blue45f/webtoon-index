/**
 * Studio Perspective Guide — 원근자(소실점 스냅) 순수 기하 모듈.
 * 사용자가 캔버스에 배치한 소실점(1~3개)을 향해 새 펜/직선 스트로크가 자동으로
 * 정렬되도록, "스트로크 시작점에서 가장 방향이 가까운 소실점"을 골라 그 소실점을
 * 지나는 무한 직선(ray)을 하나 확정하고, 이후 들어오는 포인트를 그 직선 위로
 * 수직 투영(perpendicular projection)한다.
 *
 * studio-smart-guides.ts 와 동일한 아키텍처: Konva/DOM/React 무의존 순수 함수 +
 * 타입만 export. StudioPage 의 onStageDown/onStageMove 가 이 모듈의 결과를
 * studio-brush.ts 의 stabilizePoint() 파이프라인 앞단에 끼워 넣는다(투영 → 보정 순).
 *
 * 좌표계: 호출부가 주는 좌표계(레이어 좌표) 그대로. 화면 픽셀 기준 드래그 임계를
 * 원하면 PERSPECTIVE_LOCK_MIN_DRAG 를 effScale 로 나눠 넘기면 된다(스마트가이드와 동일 관례).
 *
 * 대칭자(getSymmetricPoints, StudioPage.tsx 인라인)와의 차이: 대칭자는 "렌더할 때마다"
 * el.points 로부터 미러 변형을 매번 다시 계산하는 반면, 원근자는 "그리는 동안"에만
 * 관여하고 커밋된 el.points 는 이미 스냅이 반영된 최종 좌표라 렌더 시점에 다시 계산할
 * 것이 없다 — 그래서 DrawEl 타입에는 아무 필드도 추가하지 않는다(의도적).
 */

export interface VanishingPoint {
  id: string;
  x: number;
  y: number;
}

/** 스트로크 하나 동안 고정되는(락 걸리는) 소실점 방향 직선. */
export interface PerspectiveRay {
  vpId: string;
  originX: number;
  originY: number;
  /** 정규화된 방향 벡터(단위 벡터). 부호는 의미 없음 — 투영은 직선 전체를 대상으로 한다. */
  dirX: number;
  dirY: number;
}

/** 오버레이가 그릴 소실점 하나에서 뻗어나가는 부채꼴 안내선 한 줄(직선 전체, 양방향). */
export interface PerspectiveFanRay {
  vpId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 배치 가능한 소실점 최대 개수. */
export const MAX_VANISHING_POINTS = 3;

/** 소실점 오버레이 기본 부채꼴 안내선 개수(소실점 하나당). */
export const PERSPECTIVE_FAN_RAY_COUNT = 16;

/**
 * 방향 확정 전 최소 드래그 거리(px, 1배율 기준) — 스트로크 시작 직후 클릭 떨림만으로
 * 엉뚱한 소실점에 락이 걸리는 것을 막는다. 화면 픽셀 기준으로 쓰려면 effScale 로
 * 나눠서 호출부(StudioPage)가 넘긴다(SMART_SNAP_THRESHOLD/effScale 과 동일 관례).
 */
export const PERSPECTIVE_LOCK_MIN_DRAG = 4;

/** 소실점이 시작점과 사실상 같은 위치면 방향이 정의되지 않으므로 후보에서 제외한다. */
const MIN_VP_DISTANCE = 1e-3;

/**
 * 소실점이 눈높이(수평선)에 "이미 올라가 있다"고 볼 최대 편차(문서 px).
 * 눈높이 이동 시 같이 들어올릴 VP 판정과 잠금 시 no-op 판정에 쓴다.
 */
export const PERSPECTIVE_EYE_LEVEL_EPSILON = 0.5;

function isFiniteNumber(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n);
}

/** 캔버스 높이 기준 기본 눈높이(1점·2점 원근의 흔한 수평선). */
export function defaultPerspectiveEyeLevelY(canvasHeight: number): number {
  if (!isFiniteNumber(canvasHeight) || canvasHeight <= 0) return 0;
  return canvasHeight / 2;
}

/**
 * 수평선 잠금이 켜져 있으면 소실점 y를 눈높이로 고정한다.
 * 잠금이 꺼져 있거나 눈높이가 비유효하면 입력 좌표를 그대로 돌려준다.
 */
export function constrainVanishingPointToEyeLevel(
  x: number,
  y: number,
  options: { readonly eyeLevelY: number | null; readonly lockHorizon: boolean }
): { x: number; y: number } {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { x, y };
  if (!options.lockHorizon || options.eyeLevelY === null || !isFiniteNumber(options.eyeLevelY)) {
    return { x, y };
  }
  return { x, y: options.eyeLevelY };
}

/**
 * 눈높이를 옮길 때, 이전 수평선 위에 있던 소실점만 새 눈높이로 같이 올린다.
 * (3점 원근의 수직 VP처럼 수평선 밖 VP는 그대로 둔다.)
 */
export function movePerspectiveEyeLevel(
  points: readonly VanishingPoint[],
  previousEyeLevelY: number | null,
  nextEyeLevelY: number,
  options: { readonly epsilon?: number } = {}
): VanishingPoint[] {
  if (!isFiniteNumber(nextEyeLevelY)) return points as VanishingPoint[];
  if (previousEyeLevelY === null || !isFiniteNumber(previousEyeLevelY)) {
    // 이전 수평선이 없으면 모든 VP를 강제하지 않는다 — 호출부가 eyeLevelY 만 갱신한다.
    return points as VanishingPoint[];
  }
  if (Object.is(previousEyeLevelY, nextEyeLevelY)) return points as VanishingPoint[];
  const epsilon = options.epsilon ?? PERSPECTIVE_EYE_LEVEL_EPSILON;
  let changed = false;
  const next = points.map((point) => {
    if (!isValidVanishingPoint(point)) return point;
    if (Math.abs(point.y - previousEyeLevelY) > epsilon) return point;
    changed = true;
    return { ...point, y: nextEyeLevelY };
  });
  return changed ? next : (points as VanishingPoint[]);
}

/**
 * 선택한 눈높이로 모든 소실점 y를 맞춘다(CSP "눈높이에 맞추기").
 * 비유효 눈높이·변경 없음이면 원본 참조를 유지한다.
 */
export function alignVanishingPointsToEyeLevel(
  points: readonly VanishingPoint[],
  eyeLevelY: number
): VanishingPoint[] {
  if (!isFiniteNumber(eyeLevelY) || points.length === 0) return points as VanishingPoint[];
  let changed = false;
  const next = points.map((point) => {
    if (!isValidVanishingPoint(point)) return point;
    if (Object.is(point.y, eyeLevelY)) return point;
    changed = true;
    return { ...point, y: eyeLevelY };
  });
  return changed ? next : (points as VanishingPoint[]);
}

/**
 * 소실점 드래그/입력 공용 — 수평선 잠금이 켜진 경우 y를 눈높이로 고정한 뒤 move한다.
 * lock 이 꺼져 있으면 일반 moveVanishingPoint 와 동일하다.
 */
export function moveVanishingPointWithEyeLevel(
  points: readonly VanishingPoint[],
  id: string,
  x: number,
  y: number,
  options: { readonly eyeLevelY: number | null; readonly lockHorizon: boolean }
): VanishingPoint[] {
  const constrained = constrainVanishingPointToEyeLevel(x, y, options);
  return moveVanishingPoint(points, id, constrained.x, constrained.y);
}

function isValidVanishingPoint(vp: VanishingPoint): boolean {
  return isFiniteNumber(vp.x) && isFiniteNumber(vp.y);
}

// ---------------------------------------------------------------------------
// 1) 소실점 목록 편집 — 전부 불변(immutable), no-op 은 동일 참조를 돌려줘 렌더 안정성 유지.
// ---------------------------------------------------------------------------

/** 이미 3개(MAX_VANISHING_POINTS)면 더 추가할 수 없다. */
export function canAddVanishingPoint(points: readonly VanishingPoint[]): boolean {
  return points.length < MAX_VANISHING_POINTS;
}

/** 소실점 추가 — 이미 상한이면 원본 배열(동일 참조)을 그대로 돌려준다(no-op). */
export function addVanishingPoint(
  points: readonly VanishingPoint[],
  point: VanishingPoint
): VanishingPoint[] {
  if (!canAddVanishingPoint(points)) return points as VanishingPoint[];
  return [...points, point];
}

/** id 로 소실점 제거 — 없는 id 면 원본 배열을 그대로 돌려준다(no-op). */
export function removeVanishingPoint(
  points: readonly VanishingPoint[],
  id: string
): VanishingPoint[] {
  const next = points.filter((p) => p.id !== id);
  return next.length === points.length ? (points as VanishingPoint[]) : next;
}

/**
 * id 로 소실점 좌표를 옮긴다(드래그·숫자 입력 공용). x/y 가 NaN/Infinity 거나 id 를
 * 찾지 못하면 원본 배열을 그대로 돌려준다(no-op) — 캔버스 밖 좌표는 의도적으로 허용한다
 * (광각/극단 원근에서는 소실점이 캔버스 밖에 있는 게 정상이므로 클램프하지 않는다).
 */
export function moveVanishingPoint(
  points: readonly VanishingPoint[],
  id: string,
  x: number,
  y: number
): VanishingPoint[] {
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return points as VanishingPoint[];
  let changed = false;
  const next = points.map((p) => {
    if (p.id !== id) return p;
    changed = true;
    return { ...p, x, y };
  });
  return changed ? next : (points as VanishingPoint[]);
}

/**
 * 새 소실점을 추가할 때의 기본 좌표 — 소실점 개수에 따라 1점/2점/3점 원근의 흔한
 * 배치를 흉내낸다(결정적, 랜덤 없음):
 *   0개 → 캔버스 정중앙(1점 원근에 바로 쓸 수 있게).
 *   1개 → 첫 소실점과 같은 높이에서 캔버스 오른쪽 바깥(2점 원근의 두 번째 점).
 *   2개(이상) → 캔버스 폭 중앙, 캔버스 위쪽 바깥(3점 원근의 수직 소실점).
 */
export function defaultVanishingPointPosition(
  existing: readonly VanishingPoint[],
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;
  if (existing.length === 0) return { x: cx, y: cy };
  if (existing.length === 1) return { x: cx + canvasWidth * 0.9, y: existing[0]!.y };
  return { x: cx, y: cy - canvasHeight * 0.9 };
}

// ---------------------------------------------------------------------------
// 2) 스트로크 스냅 — 시작점 기준으로 소실점 하나를 골라 직선(ray)을 확정하고,
//    이후 들어오는 포인트를 그 직선 위로 투영한다.
// ---------------------------------------------------------------------------

/**
 * 스트로크 시작점(startX,startY)에서 현재 드래그 지점(dragX,dragY)까지의 방향과
 * 가장 가까운(각도 차가 가장 작은) 소실점을 골라 그 직선을 확정한다.
 *
 * - points 가 비어 있으면 null(원근자에 소실점이 하나도 없음).
 * - 시작점에서 드래그 지점까지 거리가 minDragDist 미만이면 아직 방향을 판단할 수
 *   없으므로 null(호출부는 다음 move 이벤트마다 다시 호출해 null 이 아닐 때 캐시한다).
 * - 시작점과 사실상 같은 위치인 소실점(거리 < MIN_VP_DISTANCE)은 방향이 정의되지
 *   않으므로 후보에서 제외한다. 유효한 후보가 하나도 없으면 null.
 * - "가장 가까운"은 단위 벡터 내적의 절대값이 가장 큰(=각도 차가 가장 작은) 소실점
 *   — 직선은 양방향이라 부호는 무시한다(±180° 는 같은 직선).
 */
export function resolvePerspectiveRay(
  points: readonly VanishingPoint[],
  startX: number,
  startY: number,
  dragX: number,
  dragY: number,
  options: { minDragDist?: number } = {}
): PerspectiveRay | null {
  const minDragDist = options.minDragDist ?? PERSPECTIVE_LOCK_MIN_DRAG;
  if (points.length === 0) return null;
  if (!isFiniteNumber(startX) || !isFiniteNumber(startY) || !isFiniteNumber(dragX) || !isFiniteNumber(dragY)) {
    return null;
  }

  const dx = dragX - startX;
  const dy = dragY - startY;
  const dragDist = Math.hypot(dx, dy);
  if (dragDist < minDragDist) return null;
  const ux = dx / dragDist;
  const uy = dy / dragDist;

  let best: VanishingPoint | null = null;
  let bestDirX = 0;
  let bestDirY = 0;
  let bestAbsDot = -1;

  for (const vp of points) {
    if (!isValidVanishingPoint(vp)) continue;
    const vx = vp.x - startX;
    const vy = vp.y - startY;
    const vpDist = Math.hypot(vx, vy);
    if (vpDist < MIN_VP_DISTANCE) continue; // 시작점과 사실상 같은 위치 — 방향 미정의
    const uvx = vx / vpDist;
    const uvy = vy / vpDist;
    const absDot = Math.abs(ux * uvx + uy * uvy);
    if (absDot > bestAbsDot) {
      bestAbsDot = absDot;
      best = vp;
      bestDirX = uvx;
      bestDirY = uvy;
    }
  }

  if (!best) return null;
  return { vpId: best.id, originX: startX, originY: startY, dirX: bestDirX, dirY: bestDirY };
}

/** 점(px,py)을 ray 가 나타내는 무한 직선 위로 수직 투영한다. */
export function projectPointOntoPerspectiveRay(px: number, py: number, ray: PerspectiveRay): [number, number] {
  const t = (px - ray.originX) * ray.dirX + (py - ray.originY) * ray.dirY;
  return [ray.originX + t * ray.dirX, ray.originY + t * ray.dirY];
}

/**
 * 스트로크 포인트 파이프라인용 원스텝 헬퍼 — ray 가 null 이면(원근자 꺼짐/미확정)
 * 입력을 그대로 돌려주므로, 호출부는 항상 안전하게 호출할 수 있다.
 * StudioPage 는 이 결과를 studio-brush.ts 의 stabilizePoint() 에 넘긴다(투영 → 보정 순).
 */
export function snapStrokePointToPerspective(px: number, py: number, ray: PerspectiveRay | null): [number, number] {
  if (!ray) return [px, py];
  return projectPointOntoPerspectiveRay(px, py, ray);
}

// ---------------------------------------------------------------------------
// 3) 오버레이 — 소실점마다 부채꼴로 뻗는 안내선(직선, 양방향) 좌표 계산.
// ---------------------------------------------------------------------------

/**
 * 소실점마다 rayCount 개의 안내선(직선 전체, 캔버스를 넉넉히 덮는 길이)을 만든다.
 * 각 선은 서로 다른 각도로, 0..π 구간을 균등 분할한다(직선은 양방향이라 π..2π 는
 * 0..π 와 같은 직선을 중복 그리게 되므로 제외). 길이는 소실점에서 캔버스 네 모서리까지
 * 최대 거리 + 여유(캔버스 최대변의 25%)로, 소실점이 캔버스 밖 멀리 있어도 항상 캔버스를
 * 완전히 가로지른다.
 * canvasWidth/canvasHeight<=0 이거나 points 가 비어 있으면 [].
 */
export function perspectiveFanRays(
  points: readonly VanishingPoint[],
  canvasWidth: number,
  canvasHeight: number,
  rayCount: number = PERSPECTIVE_FAN_RAY_COUNT
): PerspectiveFanRay[] {
  if (canvasWidth <= 0 || canvasHeight <= 0 || points.length === 0 || rayCount <= 0) return [];
  const margin = Math.max(canvasWidth, canvasHeight) * 0.25;
  const rays: PerspectiveFanRay[] = [];

  for (const vp of points) {
    if (!isValidVanishingPoint(vp)) continue;
    const corners: Array<[number, number]> = [
      [0, 0],
      [canvasWidth, 0],
      [0, canvasHeight],
      [canvasWidth, canvasHeight],
    ];
    let farthest = 0;
    for (const [cx, cy] of corners) {
      farthest = Math.max(farthest, Math.hypot(vp.x - cx, vp.y - cy));
    }
    const len = farthest + margin;

    for (let i = 0; i < rayCount; i++) {
      const angle = (i * Math.PI) / rayCount;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      rays.push({
        vpId: vp.id,
        x1: vp.x - len * cos,
        y1: vp.y - len * sin,
        x2: vp.x + len * cos,
        y2: vp.y + len * sin,
      });
    }
  }
  return rays;
}
