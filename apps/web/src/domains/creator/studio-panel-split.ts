/**
 * Studio Panel Split — 자유선(임의 각도) 패널 분할 순수 코어.
 *
 * 이미 있는 비율 슬라이더 분할(splitFrameSelected, StudioPage.tsx)은 가로/세로 축으로만
 * 자른다. 이 모듈은 캔버스 위에 손으로 그은 무한 직선을 선택된 FrameEl 의 실제 폴리곤
 * (사각형이거나 이미 사선으로 기울어진 points)과 교차시켜, 그은 선을 정확히 따라 정확히
 * 두 조각(임의 다각형 가능)으로 갈라 여백(gutter)만큼 떼어놓는다.
 *
 * FrameEl 은 회전(rotation)을 갖지 않으므로(다른 El 변형과 달리) 여기서는 전부
 * 캔버스-절대 좌표로 계산한다 — studio-crop 처럼 정규화·회전 로컬 좌표로 변환할 필요가 없다.
 *
 * FrameEl.points 는 프레임 로컬(= el.x/y 기준 상대) 좌표다(StudioPage.tsx 렌더러·
 * addDiagonalSplit 규약과 동일). 이 파일의 함수들이 받는/돌려주는 "폴리곤"은 명시하지
 * 않는 한 전부 캔버스-절대 좌표 flat 배열([x0,y0,x1,y1,...])이다.
 *
 * DOM/Konva/React 의존성 없음. FrameEl 인터페이스는 StudioPage.tsx 밖으로 export 되지
 * 않으므로, 여기서는 FrameEl 이 구조적으로 만족하는 최소 타입(FrameLikeShape)만 쓴다
 * (StudioPage.tsx 를 import 하지 않는다 — 순환 import 금지).
 *
 * 알고리즘: Sutherland–Hodgman 단일 반평면 클립을 두 번(선의 양쪽) 돌려 볼록/일반
 * 다각형을 정확히 두 조각으로 자른다. npm 기하 라이브러리는 쓰지 않는다 — studio-crop /
 * studio-selection-tools / studio-bubble-path 등 기존 모듈과 같은 관례(직접 구현).
 *
 * 한계(의도적, 범위 밖): 드래그가 화면상 여러 패널을 가로질러도 이 모듈은 언제나 "선택된
 * 프레임 하나"만 자른다 — 다른 요소는 완전히 무시한다(다중 패널 동시 컷은 범위 밖).
 */

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 절단선 정의 — 두 캔버스-절대좌표 점. 세그먼트가 아니라 무한 직선으로 취급한다. */
export type Point = { x: number; y: number };
export type PanelSplitLine = { a: Point; b: Point };

/** FrameEl 이 구조적으로 만족하는 최소 타입 — StudioPage.tsx 를 import 하지 않기 위한 로컬 구조 타입. */
export type FrameLikeShape = { x: number; y: number; width: number; height: number; points?: number[] };

/**
 * 분할 결과 하나(요소 프레임 필드). points 는 사각형이면 반드시 undefined "값"으로 키 자체는
 * 존재해야 한다 — 통합부가 `{ ...targetFrame, ...shape }` 스프레드로 기존(원본 프레임의)
 * 스큐 points 를 지우는 데 이 키의 존재 자체가 필요하기 때문이다.
 */
export type FrameShape = { x: number; y: number; width: number; height: number; points: number[] | undefined };

/** 분할 후 한쪽 변의 최소 길이(px) — 이보다 얇아지면 분할 무효. */
export const PANEL_SPLIT_MIN_SIDE_PX = 24;
/** 분할 후 한쪽 넓이의 최소값(px²) — 이보다 작아지면 분할 무효. */
export const PANEL_SPLIT_MIN_AREA_PX2 = 900;
/** 기본 여백(px) — 기존 전역 panelGutter 기본값과 일치시킨다. */
export const PANEL_SPLIT_DEFAULT_GUTTER_PX = 24;
/** 여백 슬라이더 상한(px). */
export const PANEL_SPLIT_MAX_GUTTER_PX = 96;

/** 반평면 판정 허용 오차(px) — 부동소수 오차로 정점이 선을 살짝 벗어나 오분류되지 않게 한다. */
const EPS_PX = 0.5;

/** 여백값 위생 처리 — NaN/음수는 0, 상한 초과는 상한으로 클램프. */
export function clampPanelSplitGutter(px: number): number {
  if (!Number.isFinite(px) || px < 0) return 0;
  return Math.min(px, PANEL_SPLIT_MAX_GUTTER_PX);
}

// ---------------------------------------------------------------------------
// 폴리곤 헬퍼(캔버스-절대 좌표 flat 배열)
// ---------------------------------------------------------------------------

/**
 * frame → 캔버스-절대좌표 폴리곤. points 가 있고(6개 이상 — 렌더러와 동일 임계치) 그걸
 * 절대화(el.x/y 를 더함), 없으면 x,y,width,height 사각형 4점(시계 방향: 좌상→우상→우하→좌하).
 */
export function frameAbsolutePolygon(frame: FrameLikeShape): number[] {
  const pts = frame.points;
  if (pts && pts.length >= 6) {
    const out = new Array<number>(pts.length);
    for (let i = 0; i < pts.length; i += 2) {
      out[i] = frame.x + pts[i];
      out[i + 1] = frame.y + pts[i + 1];
    }
    return out;
  }
  const { x, y, width, height } = frame;
  return [x, y, x + width, y, x + width, y + height, x, y + height];
}

/** 신발끈 공식 넓이(절대값). */
export function polygonAreaAbs(poly: number[]): number {
  const n = Math.floor(poly.length / 2);
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  return Math.abs(sum) / 2;
}

function toPoints(poly: number[]): Point[] {
  const n = Math.floor(poly.length / 2);
  const out = new Array<Point>(n);
  for (let i = 0; i < n; i++) out[i] = { x: poly[i * 2], y: poly[i * 2 + 1] };
  return out;
}

function flattenPoints(pts: { x: number; y: number }[]): number[] {
  const out = new Array<number>(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    out[i * 2] = pts[i].x;
    out[i * 2 + 1] = pts[i].y;
  }
  return out;
}

/** 폴리곤의 AABB(가로/세로)가 최소 변 기준을 만족하는지. */
function aabbMeetsMinSide(poly: number[]): boolean {
  const n = Math.floor(poly.length / 2);
  if (n < 3) return false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = poly[i * 2];
    const py = poly[i * 2 + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return maxX - minX >= PANEL_SPLIT_MIN_SIDE_PX && maxY - minY >= PANEL_SPLIT_MIN_SIDE_PX;
}

// ---------------------------------------------------------------------------
// 반평면 클립(Sutherland–Hodgman)
// ---------------------------------------------------------------------------

type TaggedPoint = Point & { onCut: boolean };

/**
 * verts 를 perp(반평면 부호거리 함수) 기준으로 클립한다.
 *   keepSign=1  → perp >= -EPS_PX 인 쪽을 유지(sideA).
 *   keepSign=-1 → perp <= EPS_PX 인 쪽을 유지(sideB).
 * 유지되는 원본 정점은 |perp| <= EPS_PX 일 때만 onCut:true, 새로 생기는 교차점은 항상 onCut:true.
 */
function clipHalfPlane(verts: Point[], perp: (p: Point) => number, keepSign: 1 | -1): TaggedPoint[] {
  const inside = (v: number) => (keepSign === 1 ? v >= -EPS_PX : v <= EPS_PX);
  const n = verts.length;
  const out: TaggedPoint[] = [];
  for (let i = 0; i < n; i++) {
    const cur = verts[i];
    const next = verts[(i + 1) % n];
    const dCur = perp(cur);
    const dNext = perp(next);
    const curIn = inside(dCur);
    const nextIn = inside(dNext);
    if (curIn) out.push({ x: cur.x, y: cur.y, onCut: Math.abs(dCur) <= EPS_PX });
    if (curIn !== nextIn) {
      const denom = dCur - dNext;
      // denom≈0 인데 in/out 이 갈렸다는 건 수치적으로 있을 수 없지만(부호가 다르면 denom≠0),
      // 방어적으로 0 나눗셈만 피한다.
      const t = denom !== 0 ? dCur / denom : 0.5;
      out.push({ x: cur.x + t * (next.x - cur.x), y: cur.y + t * (next.y - cur.y), onCut: true });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 미리보기·계획
// ---------------------------------------------------------------------------

export type PanelSplitPreview = {
  /** gutter 적용 전 절단선이 폴리곤 경계와 만나는 두 교점 — 가이드선 렌더용, 항상 폴리곤 경계 위. */
  cutSegment: [number, number, number, number];
  /** gutter 적용 후 두 영역이 모두 최소 크기 기준을 만족하는지. false 면 polyA/polyB 는 null. */
  valid: boolean;
  polyA: number[] | null;
  polyB: number[] | null;
};

/**
 * line(무한 직선)이 frame 의 절대 폴리곤을 정확히 서로 다른 두 변에서 가로지르는 경우에만
 * 결과를 낸다. 가로지르지 않거나(교차 0개) 애매하면(정점 관통 등, onCut 정점 ≠ 2) null.
 */
export function previewPanelSplit(input: {
  frame: FrameLikeShape;
  line: PanelSplitLine;
  gutterPx: number;
}): PanelSplitPreview | null {
  const { frame, line } = input;
  const poly = frameAbsolutePolygon(frame);
  if (polygonAreaAbs(poly) < PANEL_SPLIT_MIN_AREA_PX2) return null;

  const a = line.a;
  const d = { x: line.b.x - a.x, y: line.b.y - a.y };
  const lineLen = Math.hypot(d.x, d.y);
  if (lineLen < 1) return null; // 퇴화(클릭만, 드래그 없음)

  // perp(p) > 0 방향이 n̂ — 따로 "바깥쪽" 방향을 도출할 필요 없이 이 관계를 그대로 이용한다.
  const nHat = { x: -d.y / lineLen, y: d.x / lineLen };
  const perp = (p: Point) => (d.x * (p.y - a.y) - d.y * (p.x - a.x)) / lineLen;

  const verts = toPoints(poly);
  const sideA = clipHalfPlane(verts, perp, 1);
  const sideB = clipHalfPlane(verts, perp, -1);

  const onCutA = sideA.filter((v) => v.onCut);
  if (onCutA.length !== 2 || sideA.length < 3 || sideB.length < 3) return null;

  const cutSegment: [number, number, number, number] = [onCutA[0].x, onCutA[0].y, onCutA[1].x, onCutA[1].y];

  const half = clampPanelSplitGutter(input.gutterPx) / 2;
  const shiftedA = sideA.map((v) =>
    v.onCut ? { x: v.x + half * nHat.x, y: v.y + half * nHat.y } : { x: v.x, y: v.y }
  );
  const shiftedB = sideB.map((v) =>
    v.onCut ? { x: v.x - half * nHat.x, y: v.y - half * nHat.y } : { x: v.x, y: v.y }
  );

  const polyA = flattenPoints(shiftedA);
  const polyB = flattenPoints(shiftedB);

  const valid =
    polygonAreaAbs(polyA) >= PANEL_SPLIT_MIN_AREA_PX2 &&
    polygonAreaAbs(polyB) >= PANEL_SPLIT_MIN_AREA_PX2 &&
    aabbMeetsMinSide(polyA) &&
    aabbMeetsMinSide(polyB);

  if (!valid) return { cutSegment, valid: false, polyA: null, polyB: null };
  return { cutSegment, valid: true, polyA, polyB };
}

/** 절대좌표 폴리곤 → FrameShape(로컬 points 로 변환, AABB가 곧 사각형이면 points=undefined). */
export function frameShapeFromPolygon(poly: number[]): FrameShape {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const n = Math.floor(poly.length / 2);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = poly[i * 2];
    const py = poly[i * 2 + 1];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  const x = round2(minX);
  const y = round2(minY);
  const width = round2(maxX - minX);
  const height = round2(maxY - minY);

  const localPts = new Array<number>(n * 2);
  for (let i = 0; i < n; i++) {
    localPts[i * 2] = round2(poly[i * 2] - x);
    localPts[i * 2 + 1] = round2(poly[i * 2 + 1] - y);
  }

  if (n === 4) {
    const corners: [number, number][] = [
      [0, 0],
      [width, 0],
      [width, height],
      [0, height],
    ];
    let isRect = true;
    for (let i = 0; i < 4; i++) {
      const vx = localPts[i * 2];
      const vy = localPts[i * 2 + 1];
      if (!corners.some(([cx, cy]) => Math.abs(vx - cx) < 0.02 && Math.abs(vy - cy) < 0.02)) {
        isRect = false;
        break;
      }
    }
    if (isRect) return { x, y, width, height, points: undefined };
  }

  return { x, y, width, height, points: localPts };
}

/**
 * 커밋용 최종 계획. previewPanelSplit 이 null 이거나 valid=false 면 null.
 * valid 면 두 FrameShape 를 반환(각각 frameShapeFromPolygon(polyA/polyB) 결과).
 */
export function planPanelSplit(input: {
  frame: FrameLikeShape;
  line: PanelSplitLine;
  gutterPx: number;
}): { shapeA: FrameShape; shapeB: FrameShape } | null {
  const preview = previewPanelSplit(input);
  if (!preview || !preview.valid || !preview.polyA || !preview.polyB) return null;
  return {
    shapeA: frameShapeFromPolygon(preview.polyA),
    shapeB: frameShapeFromPolygon(preview.polyB),
  };
}

// ---------------------------------------------------------------------------
// 드래그 세션
// ---------------------------------------------------------------------------

/** 드래그 세션 — 시작점 + 대상 프레임 id 스냅샷만 보관(끝점은 매 pointermove 에서 즉시 읽는다). */
export type PanelSplitDragSession = { targetFrameId: string; start: Point };

export function beginPanelSplitDrag(targetFrameId: string, start: Point): PanelSplitDragSession {
  return { targetFrameId, start: { x: start.x, y: start.y } };
}
