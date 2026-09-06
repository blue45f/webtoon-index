/**
 * Studio Node Edit — 벡터 스트로크 노드 편집 순수 코어.
 *
 * 프리핸드 펜 스트로크(DrawEl, kind="freehand")의 points/pressures 배열을 사후 재조정하는
 * CSP 벡터 레이어식 "노드 편집" 도구. 새 지오메트리 엔진이 아니라 기존 points(평탄
 * [x0,y0,x1,y1,...] 배열)·pressures(포인트별 0..1 필압) 배열을 그대로 편집하는 UI 레이어다 —
 * 편집 결과는 기존 렌더 파이프라인(processFreehandPoints/smoothStrokePoints/gpenSegmentWidths,
 * studio-brush.ts)이 그대로 재사용해 그린다.
 *
 * 좌표계: DrawEl 은 x/y/rotation 이 없다 — points 는 이미 페이지(캔버스) 좌표계이므로
 * studio-crop 처럼 정규화(0..1)+프레임 변환이 필요 없다(포인터 좌표 = 페이지 좌표, 그대로 비교).
 *
 * DOM/Konva 의존성 없음 — Konva 오버레이·포인터 배선은 호출자(StudioPage)가 담당한다.
 */

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

export type NodeEditTool = "move" | "width" | "smooth";

/** 캔버스 위 조작 가능한 핸들 1개 — pointIndex 는 points 배열의 "몇 번째 점"인지(2배 아님). */
export type NodeEditHandle = {
  pointIndex: number; // points[pointIndex*2], points[pointIndex*2+1]
  x: number;
  y: number;
};

export type DecimateHandlesOptions = {
  /** 핸들 사이 최소 호길이(페이지 px). 기본 NODE_EDIT_DEFAULT_MIN_SPACING_PX. */
  minSpacingPx?: number;
  /** 핸들 개수 상한(긴 스트로크 과밀 방지). 기본 NODE_EDIT_DEFAULT_MAX_HANDLES. */
  maxHandles?: number;
};

export const NODE_EDIT_DEFAULT_MIN_SPACING_PX = 26;
export const NODE_EDIT_DEFAULT_MAX_HANDLES = 48;
/** 렌더 파이프라인이 실제로 쓰는 중립 필압(펜/마커/지우개 기본 브랜치의 무보정 값)과 일치시켜야
 * 한다 — 0.6처럼 어긋난 값을 쓰면, pressures 배열이 없는(또는 짧은) 스트로크의 "첫 굵기 편집"이
 * 그 배열을 채울 때 편집 안 한 다른 점들까지 전부 이 값으로 채워져 눈에 띄게 두꺼워진다. */
export const NODE_EDIT_DEFAULT_PRESSURE = 0.5;
/** 이 세로 드래그 거리(페이지 px, 호출부가 화면 느낌 유지를 위해 /effScale 해서 넘김)가 필압 0→1 전체 범위. */
export const NODE_EDIT_WIDTH_DRAG_RANGE_PX = 140;

export const NODE_EDIT_TOOLS: { id: NodeEditTool; label: string; tip: string }[] = [
  { id: "move", label: "이동", tip: "핸들을 끌어 그 지점의 위치를 옮깁니다." },
  { id: "width", label: "굵기", tip: "핸들을 위아래로 끌어 그 지점의 필압(굵기)을 조절합니다." },
  {
    id: "smooth",
    label: "스무딩",
    tip: "핸들을 위로 끌거나 강도 슬라이더를 올려 그 점 주변 구간을 부드럽게 다듬습니다.",
  },
];

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼
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
// 점/필압 조회
// ---------------------------------------------------------------------------

/** points 안의 "점" 개수(좌표쌍 개수). */
export function nodeEditPointCount(points: readonly number[]): number {
  return Math.floor(points.length / 2);
}

/** points[pointIndex] 위치 — 범위 밖이면 null. */
export function pointAt(points: readonly number[], pointIndex: number): { x: number; y: number } | null {
  if (pointIndex < 0 || pointIndex >= nodeEditPointCount(points)) return null;
  const x = points[pointIndex * 2];
  const y = points[pointIndex * 2 + 1];
  if (x === undefined || y === undefined) return null;
  return { x, y };
}

/** pressures[pointIndex] — 없거나 범위 밖이면 NODE_EDIT_DEFAULT_PRESSURE, 0..1로 클램프. */
export function pressureAt(pressures: readonly number[] | undefined, pointIndex: number): number {
  if (!pressures || pointIndex < 0 || pointIndex >= pressures.length) return NODE_EDIT_DEFAULT_PRESSURE;
  const raw = pressures[pointIndex];
  if (raw === undefined) return NODE_EDIT_DEFAULT_PRESSURE;
  return clamp01(raw, NODE_EDIT_DEFAULT_PRESSURE);
}

// ---------------------------------------------------------------------------
// 핸들 추출(디시메이션) + 히트테스트
// ---------------------------------------------------------------------------

/**
 * points 를 따라 호길이 기준으로 균등 간격 핸들을 뽑는다(결정적, 순수). 항상 첫점·끝점 포함.
 * n=0 → [], n=1 → 그 점 하나.
 *
 * 2단계: (1) 누적 호길이를 따라가며 minSpacingPx 이상 벌어질 때마다 핸들로 채택(첫/끝점 강제
 * 포함) → (2) 결과가 maxHandles 를 넘으면 그 핸들 목록을 균등 간격으로 다시 서브샘플링한다
 * (원래 목록이 이미 오름차순이라 서브샘플도 오름차순·중복없음이 보존된다).
 */
export function decimateStrokeHandles(
  points: readonly number[],
  opts?: DecimateHandlesOptions
): NodeEditHandle[] {
  const n = nodeEditPointCount(points);
  if (n === 0) return [];
  if (n === 1) {
    const p = pointAt(points, 0)!;
    return [{ pointIndex: 0, x: p.x, y: p.y }];
  }

  const minSpacing = sanitizePositive(opts?.minSpacingPx, NODE_EDIT_DEFAULT_MIN_SPACING_PX);
  const maxHandles = Math.max(2, Math.floor(sanitizePositive(opts?.maxHandles, NODE_EDIT_DEFAULT_MAX_HANDLES)));

  const cum = new Array<number>(n);
  cum[0] = 0;
  for (let i = 1; i < n; i++) {
    const x0 = points[(i - 1) * 2]!;
    const y0 = points[(i - 1) * 2 + 1]!;
    const x1 = points[i * 2]!;
    const y1 = points[i * 2 + 1]!;
    cum[i] = cum[i - 1]! + Math.hypot(x1 - x0, y1 - y0);
  }

  let indices: number[] = [0];
  let lastLen = cum[0]!;
  for (let i = 1; i < n - 1; i++) {
    if (cum[i]! - lastLen >= minSpacing) {
      indices.push(i);
      lastLen = cum[i]!;
    }
  }
  indices.push(n - 1);

  if (indices.length > maxHandles) {
    const step = (indices.length - 1) / (maxHandles - 1);
    const capped: number[] = [];
    for (let k = 0; k < maxHandles; k++) {
      capped.push(indices[Math.round(k * step)]!);
    }
    indices = capped.filter((v, i) => i === 0 || v !== capped[i - 1]);
  }

  const handles: NodeEditHandle[] = [];
  for (const idx of indices) {
    const p = pointAt(points, idx);
    if (p) handles.push({ pointIndex: idx, x: p.x, y: p.y });
  }
  return handles;
}

/** 포인터(페이지 좌표) 아래 가장 가까운 핸들의 pointIndex — tolerancePx(페이지 px) 밖이면 null. */
export function hitTestNodeHandle(
  pointer: { x: number; y: number },
  handles: readonly NodeEditHandle[],
  tolerancePx: number
): number | null {
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return null;
  const tol = Math.max(0, tolerancePx);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const h of handles) {
    const d = Math.hypot(h.x - pointer.x, h.y - pointer.y);
    if (d <= tol && d < bestDist) {
      bestDist = d;
      best = h.pointIndex;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 드래그 세션 — 시작 스냅샷 + 누적 델타(studio-crop 의 CropDragSession 과 동일 관례)
// ---------------------------------------------------------------------------

/** 진행 중 노드 드래그 세션 — 시작 스냅샷 + 누적 델타(studio-crop 의 CropDragSession과 동일 관례). */
export type NodeDragSession = {
  tool: NodeEditTool;
  pointIndex: number;
  startX: number;
  startY: number;
  startPressure: number;
  startPointerX: number;
  startPointerY: number;
};

/** 드래그 시작 스냅샷. pointIndex 가 points 범위 밖이면 null. */
export function beginNodeDrag(
  points: readonly number[],
  pressures: readonly number[] | undefined,
  pointIndex: number,
  tool: NodeEditTool,
  pointer: { x: number; y: number }
): NodeDragSession | null {
  const p = pointAt(points, pointIndex);
  if (!p) return null;
  return {
    tool,
    pointIndex,
    startX: p.x,
    startY: p.y,
    startPressure: pressureAt(pressures, pointIndex),
    startPointerX: pointer.x,
    startPointerY: pointer.y,
  };
}

/** "move" 세션 갱신 — 핸들의 새 (x,y)(시작점 + 누적 델타, 핸들을 살짝 빗겨 잡아도 점프 없음). */
export function updateNodeDragMove(
  session: NodeDragSession,
  pointer: { x: number; y: number }
): { x: number; y: number } {
  const dx = pointer.x - session.startPointerX;
  const dy = pointer.y - session.startPointerY;
  return { x: session.startX + dx, y: session.startY + dy };
}

/**
 * "width" 세션 갱신 — 새 필압(0..1). 위로 끌수록 굵게(+), 아래로 끌수록 가늘게(-).
 * rangePx: 0→1 전 구간에 해당하는 세로 드래그 거리(호출부가 화면 px 느낌 유지를 위해
 * effScale 로 나눠서 넘긴다 — studio-crop 의 cropHitTolerance 관례와 동일).
 */
export function updateNodeDragWidth(
  session: NodeDragSession,
  pointer: { x: number; y: number },
  rangePx?: number
): number {
  const range = sanitizePositive(rangePx, NODE_EDIT_WIDTH_DRAG_RANGE_PX);
  const dy = pointer.y - session.startPointerY;
  // 화면 y 는 아래로 증가하므로 위로 끌면(dy<0) 필압이 커지도록 부호를 반전한다.
  return clamp01(session.startPressure - dy / range, session.startPressure);
}

// ---------------------------------------------------------------------------
// 불변 배열 갱신
// ---------------------------------------------------------------------------

/** points 배열에서 pointIndex 위치만 (x,y)로 교체한 **새** 배열(불변). 범위 밖이면 원본 복사본 그대로. */
export function withPointMoved(points: readonly number[], pointIndex: number, x: number, y: number): number[] {
  const out = points.slice();
  if (pointIndex < 0 || pointIndex >= nodeEditPointCount(points)) return out;
  out[pointIndex * 2] = x;
  out[pointIndex * 2 + 1] = y;
  return out;
}

/**
 * pressures 배열에서 pointIndex 필압만 교체한 **새** 배열(불변), 길이는 pointCount 로 정규화.
 * pressures 가 없거나 짧으면 NODE_EDIT_DEFAULT_PRESSURE 로 채운 뒤 교체한다(첫 굵기 편집 시
 * pressures 배열이 points 길이에 맞게 "승격"된다 — 의도된 동작).
 */
export function withPressureEdited(
  pressures: readonly number[] | undefined,
  pointCount: number,
  pointIndex: number,
  pressure: number
): number[] {
  const n = Math.max(0, Math.floor(pointCount));
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const raw = pressures && i < pressures.length ? pressures[i] : undefined;
    out[i] = raw === undefined ? NODE_EDIT_DEFAULT_PRESSURE : clamp01(raw, NODE_EDIT_DEFAULT_PRESSURE);
  }
  if (pointIndex >= 0 && pointIndex < n) {
    out[pointIndex] = clamp01(pressure, NODE_EDIT_DEFAULT_PRESSURE);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 대상 판정
// ---------------------------------------------------------------------------

/** kind 가 "freehand"(또는 미설정=기본값)인지 — 노드 편집은 프리핸드 전용. */
export function isNodeEditableKind(kind: string | undefined): boolean {
  return kind === undefined || kind === "freehand";
}

/**
 * 이 브러시/모드 조합이 실제로 필압→굵기 렌더링에 반영되는지 — StudioDrawNode 의 브랜치
 * 분기와 1:1 대응(pen/gpen/marker/watercolor + 모든 eraser 스트로크는 pressures 를 읽는다;
 * brush/screentone/pencil/highlighter 는 고정 굵기라 "굵기" 모드가 시각적으로 무의미하다).
 */
export function isPressureWidthBrush(brush: string | undefined, mode: "pen" | "eraser" | undefined): boolean {
  // StudioDrawNode 는 brush 별 조기 분기를 모두 `el.mode !== "eraser"` 로 가드한다 — 즉
  // eraser 모드면 브러시와 무관하게 항상 필압을 읽는 기본(default) 분기로 떨어진다.
  if (mode === "eraser") return true;
  const b = brush ?? "pen";
  return (
    b === "pen" ||
    b === "fineliner" ||
    b === "ballpoint" ||
    b === "gpen" ||
    b === "liner" ||
    b === "marker" ||
    b === "felt-tip" ||
    b === "marker-bold" ||
    b === "watercolor"
  );
}
