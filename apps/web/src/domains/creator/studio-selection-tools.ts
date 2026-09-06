/**
 * Studio Selection Tools — 픽셀 선택 도구(포토샵식 마퀴/올가미) 순수 코어.
 *
 * ⚠️ 이름이 비슷한 studio-selection.ts 와는 **다른 개념**이다:
 *   - studio-selection.ts       : "요소 선택" — 캔버스 위 요소(El)들을 마퀴로 다중 선택/정렬.
 *   - studio-selection-tools.ts : "픽셀 선택" — 한 이미지 요소 **안쪽 픽셀 영역**을
 *     사각/타원/올가미/브러시로 선택해 부분 조정(밝기/색조)·부분 삭제를 가하는 도구.
 *
 * 좌표 규약 3계층:
 *   1. 정규화(u,v 0..1)  — 이미지 요소의 비회전 로컬 박스 기준. 선택 영역의 저장 형식.
 *      요소를 리사이즈해도 선택이 함께 따라간다(해상도 무관).
 *   2. 요소 로컬 px       — u*width, v*height. 마칭앤츠 오버레이용(회전은 Konva Group 이 적용).
 *   3. 마스크 디바이스 px — u*naturalWidth. 원본 해상도 오프스크린 마스크 래스터용.
 *
 * 마스크 래스터 의미론(순차 덮어쓰기):
 *   합치기(add)=fill(source-over), 빼기(subtract)=erase(destination-out)를 서브패스 순서대로
 *   칠한다 → 픽셀의 최종 상태는 "그 픽셀을 덮는 마지막 서브패스의 모드". pointInSelection 이
 *   동일 규칙을 수식으로 구현해 히트테스트와 래스터 결과가 항상 일치한다.
 *   폴리곤 서브패스는 evenodd 채움, 브러시 서브패스는 라운드 캡/조인 스트로크(굵기=2×반경)로
 *   칠한다 — 같은 add/subtract·feather·invert 규약을 공유한다.
 *   feather 는 완성된 하드 마스크 전체에 blur(px) 한 번, invert 는 맨 마지막에 알파 반전.
 *
 * DOM 의존성 없음 — 캔버스에 실제로 그리는 함수(paintSelectionMaskSteps 등)도 구조 타입
 * (MaskCtx2DLike)과 주입 팩토리(SelectionCanvasFactory)만 받아 순수하게 유지한다.
 * 실제 CanvasRenderingContext2D/HTMLCanvasElement 는 구조상 호환된다(테스트에서 컴파일 검증).
 * 모두 결정적(랜덤·Date 없음) — 마칭앤츠도 경과시간을 인자로 받는다.
 */

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 정규화 점 — 이미지 요소 비회전 로컬 박스 기준 0..1(올가미는 살짝 벗어남 허용). */
export type SelPoint = { x: number; y: number };

/** 픽셀 선택 도구 종류 — rect/ellipse/lasso/poly-lasso 는 폴리곤, brush 는 궤적+반경. */
export type SelectionToolKind = "rect" | "ellipse" | "lasso" | "poly-lasso" | "brush";

/** 서브패스 결합 모드 — 합치기(fill) / 빼기(erase) / 교집합(intersect). */
export type SelectionCombineMode = "add" | "subtract" | "intersect";

/**
 * 사용자가 다음 선택 제스처에 기대하는 작업.
 *
 * `replace`는 저장되는 서브패스 모드가 아니다. 새 제스처를 빈 선택에 `add`로 적용하는 UI
 * 의도다. 이를 SelectionSubpath.mode에 저장하지 않아 기존 문서·Worker·CRDT 스키마는 그대로
 * 유지하면서도 Photoshop/CSP/Magma의 기본 "새 선택" 동작을 제공한다.
 */
export type SelectionOperationMode = "replace" | SelectionCombineMode;

/** 폴리곤 서브패스 — rect/ellipse/lasso 가 수렴하는 형식(≥3점, 자동 닫힘). kind 없음 = 하위호환. */
export type SelectionPolygonSubpath = { mode: SelectionCombineMode; kind?: never; points: SelPoint[] };

/**
 * 브러시 서브패스 — 드래그 궤적(정규화 점 ≥1개)과 정규화 반경. 래스터 시 라운드 캡/조인
 * 스트로크(굵기 2×반경)로 칠한다 — 점 1개는 반경만큼의 점 찍기(탭)다.
 * 반경은 요소 "폭" 대비 비율 한 축으로 정규화한다(캔버스 px ÷ 요소 폭 — 페더의
 * featherScale(원본폭/요소폭) 환산과 같은 규약). 요소가 원본 종횡비와 다르게 늘려져
 * 있으면 세로 방향 실효 반경이 그 비율만큼 달라진다(정직한 근사 — 주석으로 명시).
 */
export type SelectionBrushSubpath = { mode: SelectionCombineMode; kind: "brush"; points: SelPoint[]; radius: number };

/** 선택 서브패스 — 폴리곤 또는 브러시 획. 기존 {mode, points} 데이터는 폴리곤으로 파싱된다. */
export type SelectionSubpath = SelectionPolygonSubpath | SelectionBrushSubpath;

/** 픽셀 선택 영역 전체 상태 — 이미지 요소 1개에 귀속된다(요소 전환 시 해제). */
export type PixelSelection = {
  subpaths: SelectionSubpath[];
  /** 가장자리 페더(px) — 캔버스 표시 px 기준. 래스터 시 featherScale 로 원본 px 환산. */
  featherPx: number;
  /** 반전 — 서브패스 바깥을 선택(서브패스 0개 + 반전 = 전체 선택). */
  invert: boolean;
};

/** 페더 슬라이더 범위(캔버스 표시 px). */
export const SELECTION_FEATHER_RANGE = { min: 0, max: 60, step: 1 } as const;
/** 선택 영역 밝기 조정 범위(%p — 0=변화 없음). */
export const SELECTION_BRIGHTNESS_RANGE = { min: -100, max: 100, step: 1 } as const;
/** 선택 영역 색조 회전 범위(° — 0=변화 없음). */
export const SELECTION_HUE_RANGE = { min: -180, max: 180, step: 1 } as const;
/** 브러시 선택 반경 슬라이더 범위(캔버스 표시 px). */
export const SELECTION_BRUSH_RADIUS_RANGE = { min: 8, max: 120, step: 1 } as const;
/** 브러시 선택 반경 기본값(캔버스 표시 px). */
export const SELECTION_BRUSH_RADIUS_DEFAULT = 28;

/** 타원 → 폴리곤 근사 분할 수(기본). 48이면 픽셀 마스크에서 사실상 매끈하다. */
export const ELLIPSE_POLYGON_SEGMENTS = 48;
/** 올가미 이웃 점 최소 간격(정규화) — 이보다 가까우면 궤적에 추가하지 않는다. */
export const LASSO_MIN_POINT_DIST = 0.004;
/** 의미 있는 서브패스 최소 면적(정규화 단위²) — 우발 클릭/찰나 드래그 제외. */
export const MIN_SELECTION_SUBPATH_AREA = 0.00001;
/** 올가미 점 허용 범위 — 박스를 살짝 벗어난 드래그를 보존(마스크 캔버스가 어차피 클립). */
const SEL_POINT_MIN = -0.25;
const SEL_POINT_MAX = 1.25;
/** 원본 해상도 환산 후 페더 상한(px) — 비정상 배율로 인한 과도한 blur 방지. */
const MAX_DEVICE_FEATHER_PX = 250;
/** 정규화 브러시 반경 상한(요소 폭 대비 4배) — 비정상 입력 방어(음수/NaN 은 0으로). */
const MAX_BRUSH_RADIUS_NORM = 4;

/** 도구 선택 칩 목록 — 패널에서 id/라벨/설명으로 사용. */
export const SELECTION_TOOLS: { id: SelectionToolKind; label: string; tip: string }[] = [
  { id: "rect", label: "사각형", tip: "드래그한 사각형 안쪽 픽셀을 선택합니다." },
  { id: "ellipse", label: "타원", tip: "드래그한 박스에 내접하는 타원 안쪽을 선택합니다." },
  { id: "lasso", label: "올가미", tip: "자유롭게 그린 궤적 안쪽을 선택합니다(자동 닫힘). 자유형 올가미." },
  {
    id: "poly-lasso",
    label: "다각형 올가미",
    tip: "클릭으로 꼭짓점을 찍고, 더블클릭 또는 Enter로 닫습니다. Esc로 취소.",
  },
  { id: "brush", label: "브러시", tip: "붓으로 칠한 자리(둥근 획)를 선택합니다. 반경 슬라이더로 굵기를 조절하세요." },
];

/** 결합 모드 칩 목록. */
export const SELECTION_COMBINE_MODES: { id: SelectionCombineMode; label: string; tip: string }[] = [
  { id: "add", label: "합치기", tip: "기존 선택 영역에 새 영역을 더합니다." },
  { id: "subtract", label: "빼기", tip: "기존 선택 영역에서 새 영역을 뺍니다." },
  { id: "intersect", label: "교집합", tip: "기존 선택과 새 영역이 겹치는 부분만 남깁니다." },
];

/** 다음 선택 제스처 작업 — 기본은 기존 영역을 교체하는 `replace`. */
export const SELECTION_OPERATION_MODES: {
  id: SelectionOperationMode;
  label: string;
  tip: string;
  shortcut?: string;
}[] = [
  {
    id: "replace",
    label: "새 선택",
    tip: "기존 선택을 지우고 새로 그린 영역으로 교체합니다.",
  },
  {
    id: "add",
    label: "추가",
    tip: "기존 선택 영역에 새 영역을 더합니다.",
    shortcut: "Shift",
  },
  {
    id: "subtract",
    label: "빼기",
    tip: "기존 선택 영역에서 새 영역을 뺍니다.",
    shortcut: "Alt/Option",
  },
  {
    id: "intersect",
    label: "교차",
    tip: "기존 선택과 새 영역이 겹치는 부분만 남깁니다.",
    shortcut: "Shift+Alt",
  },
];

/** `replace`는 기존 선택을 버리고, 나머지는 기존 선택을 결합 기준으로 사용한다. */
export function selectionOperationBase(
  selection: PixelSelection | null,
  operation: SelectionOperationMode
): PixelSelection | null {
  return operation === "replace" ? null : selection;
}

/** 저장 가능한 실제 서브패스 모드로 낮춘다. */
export function selectionCombineModeForOperation(
  operation: SelectionOperationMode
): SelectionCombineMode {
  return operation === "replace" ? "add" : operation;
}

/** 확장/축소 슬라이더 범위(정규화 단위 — 약 이미지 폭의 %). */
export const SELECTION_EXPAND_RANGE = { min: 0.005, max: 0.08, step: 0.005 } as const;
export const SELECTION_EXPAND_DEFAULT = 0.02;

// ---------------------------------------------------------------------------
// 내부 수치 헬퍼
// ---------------------------------------------------------------------------

/** 비유한 값을 fallback 으로, 나머지는 [lo, hi]로 클램프. */
function clampNum(v: number, lo: number, hi: number, fallback = 0): number {
  if (!Number.isFinite(v)) return fallback;
  return v < lo ? lo : v > hi ? hi : v;
}

/** 정규화 점 위생 처리 — NaN 방어 + 도구별 허용 범위 클램프. */
function sanitizePoint(p: SelPoint, lo: number, hi: number): SelPoint {
  return { x: clampNum(p.x, lo, hi), y: clampNum(p.y, lo, hi) };
}

// ---------------------------------------------------------------------------
// (1) 도구 → 정규화 폴리곤
// ---------------------------------------------------------------------------

/** 사각형 선택 — 드래그 시작/끝(순서 무관)을 0..1로 클램프한 4점 폴리곤으로. */
export function rectSelectionPolygon(a: SelPoint, b: SelPoint): SelPoint[] {
  // 각 입력을 먼저 위생 처리(NaN→0) — min/max 에 NaN 이 들어가 양끝을 같이 오염시키지 않도록.
  const ax = clampNum(a.x, 0, 1);
  const ay = clampNum(a.y, 0, 1);
  const bx = clampNum(b.x, 0, 1);
  const by = clampNum(b.y, 0, 1);
  const x1 = Math.min(ax, bx);
  const x2 = Math.max(ax, bx);
  const y1 = Math.min(ay, by);
  const y2 = Math.max(ay, by);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

/** 타원 선택 — 드래그 박스 내접 타원을 segments 각형 폴리곤으로 근사(0..1 클램프). */
export function ellipseSelectionPolygon(
  a: SelPoint,
  b: SelPoint,
  segments = ELLIPSE_POLYGON_SEGMENTS
): SelPoint[] {
  const n = Math.round(clampNum(segments, 8, 96, ELLIPSE_POLYGON_SEGMENTS));
  const cx = (clampNum(a.x, 0, 1) + clampNum(b.x, 0, 1)) / 2;
  const cy = (clampNum(a.y, 0, 1) + clampNum(b.y, 0, 1)) / 2;
  const rx = Math.abs(clampNum(b.x, 0, 1) - clampNum(a.x, 0, 1)) / 2;
  const ry = Math.abs(clampNum(b.y, 0, 1) - clampNum(a.y, 0, 1)) / 2;
  const pts: SelPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: clampNum(cx + rx * Math.cos(t), 0, 1), y: clampNum(cy + ry * Math.sin(t), 0, 1) });
  }
  return pts;
}

/**
 * 선택 제스처 수정자 — Shift=정사각/정원, Alt=클릭 중심 확장.
 * aspect = 요소 height/width (정규화 공간에서 화면상 정원을 만들기 위함).
 * 반환 { a, b } 는 rect/ellipseSelectionPolygon 에 그대로 넘길 코너.
 */
export function constrainSelectionDragCorners(
  start: SelPoint,
  current: SelPoint,
  opts?: { shift?: boolean; alt?: boolean; aspect?: number; forceCircle?: boolean }
): { a: SelPoint; b: SelPoint } {
  const aspect = Number.isFinite(opts?.aspect) && (opts?.aspect ?? 0) > 0 ? opts!.aspect! : 1;
  let ax = start.x;
  let ay = start.y;
  let bx = current.x;
  let by = current.y;
  if (opts?.alt) {
    // 중심=start, 반대편=start-(current-start)
    bx = current.x;
    by = current.y;
    ax = 2 * start.x - current.x;
    ay = 2 * start.y - current.y;
  }
  if (opts?.shift || opts?.forceCircle) {
    // 화면 픽셀 기준 정사각/정원: Δy_px = Δx_px → Δy_norm = Δx_norm / aspect
    const dx = bx - ax;
    const dy = by - ay;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy) * aspect;
    const side = Math.max(adx, ady);
    const sx = Math.sign(dx) || 1;
    const sy = Math.sign(dy) || 1;
    if (opts?.alt) {
      // 중심 고정, 반쪽 변 길이 side/2
      const hx = (side / 2) * sx;
      const hy = ((side / 2) / aspect) * sy;
      return {
        a: { x: start.x - Math.abs(hx), y: start.y - Math.abs(hy) },
        b: { x: start.x + Math.abs(hx), y: start.y + Math.abs(hy) },
      };
    }
    bx = ax + sx * side;
    by = ay + (sy * side) / aspect;
  }
  return { a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

/** 원형 선택 — 드래그 박스를 정원(종횡비 보정)으로 강제. */
export function circleSelectionPolygon(
  a: SelPoint,
  b: SelPoint,
  aspect = 1,
  segments = ELLIPSE_POLYGON_SEGMENTS
): SelPoint[] {
  const corners = constrainSelectionDragCorners(a, b, { forceCircle: true, aspect });
  return ellipseSelectionPolygon(corners.a, corners.b, segments);
}

/**
 * 궤적 연장 판정 — 마지막 점과 minDist 미만이면 false. appendLassoPoint(불변)와
 * appendLassoPointInPlace(제자리)가 **같은 이 함수 하나**를 공유하므로 두 경로의 채택 판정은
 * 정의상 동일하다(부동소수 비교식이 하나뿐이라 갈라질 수 없다).
 */
function extendsSelectionTrail(
  last: SelPoint | undefined,
  next: SelPoint,
  minDist: number
): boolean {
  if (!last) return true;
  const dx = next.x - last.x;
  const dy = next.y - last.y;
  // 원래의 `< minDist²` 판정을 부호까지 그대로 보존한다. `>=` 로 뒤집으면 NaN 입력에서
  // (NaN 비교는 항상 false) 채택/거부가 뒤바뀐다 — 위생 처리되지 않은 궤적에 대한 동작 변화.
  return !(dx * dx + dy * dy < minDist * minDist);
}

/**
 * 올가미 궤적에 점 추가 — 마지막 점과 minDist 미만이면 기존 배열을 그대로 반환(추가 없음).
 * 불변: 추가 시 새 배열을 만든다(React 상태로 바로 쓸 수 있음).
 */
export function appendLassoPoint(
  points: readonly SelPoint[],
  p: SelPoint,
  minDist = LASSO_MIN_POINT_DIST
): SelPoint[] {
  const next = sanitizePoint(p, SEL_POINT_MIN, SEL_POINT_MAX);
  if (!extendsSelectionTrail(points[points.length - 1], next, minDist)) return points as SelPoint[];
  return [...points, next];
}

/**
 * appendLassoPoint 의 제자리(mutable) 쌍 — 같은 sanitize/간격 규약으로 판정하고, 채택된
 * 점만 배열 끝에 push 한다. 반환값은 "추가되었는가". 세션이 소유한 배열에만 쓸 것.
 * 매 포인터 이동마다 배열 전체를 spread 복제하던 O(n²) 누적을 O(1) 추가로 바꾼다.
 */
export function appendLassoPointInPlace(
  points: SelPoint[],
  p: SelPoint,
  minDist = LASSO_MIN_POINT_DIST
): boolean {
  const next = sanitizePoint(p, SEL_POINT_MIN, SEL_POINT_MAX);
  if (!extendsSelectionTrail(points[points.length - 1], next, minDist)) return false;
  points.push(next);
  return true;
}

/** 브러시 이웃 점 최소 간격(정규화) — 반경의 20%. 굵을수록 성기게 저장해도 라운드 조인이 획을 메운다. */
export function brushPointMinDist(radiusNorm: number): number {
  return Math.max(LASSO_MIN_POINT_DIST, clampNum(radiusNorm, 0, MAX_BRUSH_RADIUS_NORM) * 0.2);
}

/** 브러시 궤적에 점 추가 — appendLassoPoint 와 동일한 불변 규약(안 늘면 같은 배열), 간격만 반경 비례. */
export function appendBrushPoint(points: readonly SelPoint[], p: SelPoint, radiusNorm: number): SelPoint[] {
  return appendLassoPoint(points, p, brushPointMinDist(radiusNorm));
}

/** appendBrushPoint 의 제자리 쌍 — 같은 간격 규약, 배열 복제 없이 push. 반환값은 "추가되었는가". */
export function appendBrushPointInPlace(
  points: SelPoint[],
  p: SelPoint,
  radiusNorm: number
): boolean {
  return appendLassoPointInPlace(points, p, brushPointMinDist(radiusNorm));
}

/**
 * 올가미 폴리곤 단순화 — 이웃 중복점 제거 + 일직선 위 중간점 제거 + 시작·끝 중복 닫음 제거.
 * 마스크 품질은 유지하면서 문서에 저장되는 점 수를 줄인다.
 */
export function simplifyLassoPolygon(points: readonly SelPoint[], minDist = LASSO_MIN_POINT_DIST): SelPoint[] {
  const dedup: SelPoint[] = [];
  for (const raw of points) {
    const p = sanitizePoint(raw, SEL_POINT_MIN, SEL_POINT_MAX);
    const last = dedup[dedup.length - 1];
    if (last) {
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      if (dx * dx + dy * dy < minDist * minDist) continue;
    }
    dedup.push(p);
  }
  // 폴리곤은 자동으로 닫히므로 마지막 점이 첫 점과 겹치면 버린다.
  if (dedup.length >= 2) {
    const first = dedup[0]!;
    const last = dedup[dedup.length - 1]!;
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    if (dx * dx + dy * dy < minDist * minDist) dedup.pop();
  }
  if (dedup.length < 3) return dedup;
  // 일직선 위 중간점 제거 — 외적(교차곱)이 0에 가까우면 꺾임이 없는 점.
  const out: SelPoint[] = [];
  const EPS = 1e-9;
  for (let i = 0; i < dedup.length; i += 1) {
    const prev = out[out.length - 1] ?? dedup[(i + dedup.length - 1) % dedup.length]!;
    const cur = dedup[i]!;
    const next = dedup[(i + 1) % dedup.length]!;
    const cross = (cur.x - prev.x) * (next.y - prev.y) - (cur.y - prev.y) * (next.x - prev.x);
    if (Math.abs(cross) > EPS || out.length < 1) out.push(cur);
  }
  return out.length >= 3 ? out : dedup;
}

// ---------------------------------------------------------------------------
// (2) 폴리곤 기하 — 면적·포함 판정
// ---------------------------------------------------------------------------

/** 신발끈 공식 절대 면적(정규화 단위²). 점 3개 미만이면 0. */
export function polygonAreaNorm(points: readonly SelPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    sum += p.x * q.y - q.x * p.y;
  }
  return Math.abs(sum) / 2;
}

/** 점-폴리곤 포함 판정(even-odd 레이 캐스팅) — 경계는 근사 포함. */
export function pointInPolygon(p: SelPoint, poly: readonly SelPoint[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i]!;
    const b = poly[j]!;
    const crossesY = a.y > p.y !== b.y > p.y;
    if (crossesY && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 점-선분 최소 거리² — y 에 aspect(세로/가로 px 비)를 곱한 "폭 정규화" 공간에서 잰다. */
function distSqToSegmentScaled(p: SelPoint, a: SelPoint, b: SelPoint, aspect: number): number {
  const px = p.x;
  const py = p.y * aspect;
  const ax = a.x;
  const ay = a.y * aspect;
  const dx = b.x - ax;
  const dy = b.y * aspect - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? clampNum(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1) : 0;
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/**
 * 점이 브러시 서브패스(둥근 획) 위인지 — 궤적 선분까지의 거리 ≤ 반경.
 * 브러시는 디바이스 px 에서 원형이므로, 정규화 공간에서 정확히 재려면 aspect(=높이px/폭px)가
 * 필요하다. 기본 1 = 정사각 가정 근사(마스크 래스터가 진실이며 이 판정은 보조 히트테스트).
 */
export function pointOnBrushSubpath(p: SelPoint, sp: SelectionBrushSubpath, aspect = 1): boolean {
  const r = clampNum(sp.radius, 0, MAX_BRUSH_RADIUS_NORM);
  if (r <= 0 || sp.points.length === 0) return false;
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const rSq = r * r;
  if (sp.points.length === 1) return distSqToSegmentScaled(p, sp.points[0]!, sp.points[0]!, a) <= rSq;
  for (let i = 0; i < sp.points.length - 1; i += 1) {
    if (distSqToSegmentScaled(p, sp.points[i]!, sp.points[i + 1]!, a) <= rSq) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// (3) 선택 상태 — 생성·결합(합집합/빼기)·페더·반전 (전부 불변)
// ---------------------------------------------------------------------------

/** 빈 선택 상태 — 서브패스 0개, 페더 0, 반전 없음. */
export function emptyPixelSelection(): PixelSelection {
  return { subpaths: [], featherPx: 0, invert: false };
}

/**
 * 서브패스 추가(합치기/빼기/교집합 결합) — 점 위생 처리 후 면적이 무의미하면 기존 선택을 그대로 반환.
 * sel 이 null 이면 빈 선택에서 시작한다.
 * intersect: 기존 선택 ∩ 새 폴리곤 — 기존 서브패스를 비우고 교집합 영역을 단일 add 로 대체한다.
 */
export function addSelectionSubpath(
  sel: PixelSelection | null,
  mode: SelectionCombineMode,
  points: readonly SelPoint[]
): PixelSelection | null {
  const clean = points.map((p) => sanitizePoint(p, SEL_POINT_MIN, SEL_POINT_MAX));
  if (clean.length < 3 || polygonAreaNorm(clean) < MIN_SELECTION_SUBPATH_AREA) return sel;
  if (mode === "intersect") {
    return intersectSelectionWithPolygon(sel, clean);
  }
  const base = sel ?? emptyPixelSelection();
  return { ...base, subpaths: [...base.subpaths, { mode, points: clean }] };
}

/**
 * 기존 선택 ∩ 폴리곤 — 샘플 그리드로 교집합 외곽 bbox를 잡고, 그 안을 새 add 폴리곤(입력 poly)으로
 * 두되 반전·기존 서브패스를 제거한 뒤 "새 영역 중 기존에 있던 점만" 남기도록 마스크 근사한다.
 * 정확도: poly 자체가 새 선택의 윤곽; 기존 선택 밖 점은 빼기 서브패스로 근사하지 않고
 * sample-and-keep 으로 poly를 클리핑한 단순 버전을 쓴다(상업용 근사, 유닛 테스트 가능).
 */
export function intersectSelectionWithPolygon(
  sel: PixelSelection | null,
  poly: readonly SelPoint[]
): PixelSelection | null {
  const clean = poly.map((p) => sanitizePoint(p, SEL_POINT_MIN, SEL_POINT_MAX));
  if (clean.length < 3 || polygonAreaNorm(clean) < MIN_SELECTION_SUBPATH_AREA) return sel;
  if (!isSelectionUsable(sel)) {
    // 기존 선택이 없으면 교집합 결과는 빈 선택과 같다.
    return null;
  }
  // Dense sample: keep vertices of poly that lie inside old selection; if few, fall back to poly
  // only when majority of grid samples inside poly are also in old selection.
  const kept = clean.filter((p) => pointInSelection(sel, p));
  if (kept.length >= 3 && polygonAreaNorm(kept) >= MIN_SELECTION_SUBPATH_AREA) {
    return {
      featherPx: sel!.featherPx,
      invert: false,
      subpaths: [{ mode: "add", points: kept }],
    };
  }
  // Grid sample rebuild of intersection bbox polygon (rect approx of common area).
  const N = 32;
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let hits = 0;
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const p = { x: i / N, y: j / N };
      if (pointInPolygon(p, clean) && pointInSelection(sel, p)) {
        hits += 1;
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
    }
  }
  if (hits === 0) return null;
  const box = rectSelectionPolygon({ x: minX, y: minY }, { x: maxX, y: maxY });
  return {
    featherPx: sel!.featherPx,
    invert: false,
    subpaths: [{ mode: "add", points: box }],
  };
}

/** 전체 선택 — 반전+빈 서브패스(Ctrl+A 상당). 페더는 유지. */
export function selectAllPixels(sel: PixelSelection | null = null): PixelSelection {
  return { subpaths: [], featherPx: sel?.featherPx ?? 0, invert: true };
}

/**
 * 선택 영역 확장/축소 — 폴리곤 꼭짓점을 중심에서 바깥/안쪽으로 밀고, 브러시 반경을 키우거나 줄인다.
 * amountNorm > 0 확장, < 0 축소. 축소 후 면적이 너무 작으면 null.
 */
export function expandContractSelection(
  sel: PixelSelection | null,
  amountNorm: number
): PixelSelection | null {
  if (!isSelectionUsable(sel)) return null;
  const amount = clampNum(amountNorm, -0.5, 0.5, 0);
  if (amount === 0) return sel;
  if (sel!.invert && amount > 0) return sel; // 이미 전체 선택이면 확장 의미 없음
  if (sel!.invert && amount < 0) {
    // 전체 선택 축소 ≈ 가장자리 inset 박스 선택(반전 해제 + 안쪽 사각형)
    const inset = Math.min(0.45, Math.abs(amount));
    return {
      featherPx: sel!.featherPx,
      invert: false,
      subpaths: [
        {
          mode: "add",
          points: rectSelectionPolygon({ x: inset, y: inset }, { x: 1 - inset, y: 1 - inset }),
        },
      ],
    };
  }
  const nextSubs: SelectionSubpath[] = [];
  for (const sp of sel!.subpaths) {
    if (sp.kind === "brush") {
      const radius = clampNum(sp.radius + amount, 0, MAX_BRUSH_RADIUS_NORM);
      // 축소로 반경이 사실상 0 이 되면 그 획은 제거한다.
      if (radius < 0.001) continue;
      nextSubs.push({ ...sp, radius });
      continue;
    }
    const cx = sp.points.reduce((s, p) => s + p.x, 0) / sp.points.length;
    const cy = sp.points.reduce((s, p) => s + p.y, 0) / sp.points.length;
    // 축소 시 꼭짓점이 중심을 지나 뒤집히면(newLen≤0) 영역이 커지거나 뒤집히므로 서브패스를 폐기한다.
    let collapsed = false;
    const scaled: SelPoint[] = [];
    for (const p of sp.points) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const len = Math.hypot(dx, dy) || 1e-6;
      const newLen = len + amount;
      if (newLen <= 1e-6) {
        collapsed = true;
        break;
      }
      const scale = newLen / len;
      scaled.push(sanitizePoint({ x: cx + dx * scale, y: cy + dy * scale }, SEL_POINT_MIN, SEL_POINT_MAX));
    }
    if (collapsed) continue;
    if (scaled.length >= 3 && polygonAreaNorm(scaled) >= MIN_SELECTION_SUBPATH_AREA) {
      nextSubs.push({ mode: sp.mode, points: scaled });
    }
  }
  if (nextSubs.length === 0 && !sel!.invert) return null;
  return { ...sel!, subpaths: nextSubs };
}

/** 선택 마퀴 회전 각도 슬라이더 범위(도). */
export const SELECTION_ROTATE_RANGE = { min: -180, max: 180, step: 1 } as const;
/** 선택 마퀴 회전 프리셋(도) — 패널 빠른 버튼. */
export const SELECTION_ROTATE_PRESETS = [-90, 90, 180] as const;

/**
 * 선택 영역 중심(정규화) — add 서브패스 bbox 중심. 반전 전체 선택이면 (0.5, 0.5).
 * 쓸 수 없는 선택이면 null.
 */
export function selectionCentroidNorm(sel: PixelSelection | null): SelPoint | null {
  const b = selectionBoundsNorm(sel);
  if (!b) return null;
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/**
 * 정규화 좌표 한 점을 중심 기준으로 회전.
 * aspect = 요소 높이/폭 — 비정사각 이미지에서도 화면상 각도가 맞게 돌리기 위한 y축 스케일.
 */
function rotateNormPoint(p: SelPoint, cx: number, cy: number, cos: number, sin: number, aspect: number): SelPoint {
  const A = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const sx = p.x - cx;
  const sy = (p.y - cy) * A;
  const rx = sx * cos - sy * sin;
  const ry = sx * sin + sy * cos;
  return sanitizePoint({ x: cx + rx, y: cy + ry / A }, SEL_POINT_MIN, SEL_POINT_MAX);
}

/**
 * 선택 마퀴 회전(Transform Selection) — 픽셀 내용은 건드리지 않고 경계 기하만 돌린다.
 * degrees: 시계 방향 양수(캔버스 y-down 기준 CSS/Canvas 와 동일).
 * opts.aspect: 요소 height/width (기본 1). 비정사각일 때 필수에 가깝다.
 * 전체 반전 선택(서브패스 0)은 대칭이라 그대로 반환. 면적이 사라지면 null.
 */
export function rotateSelection(
  sel: PixelSelection | null,
  degrees: number,
  opts?: { aspect?: number }
): PixelSelection | null {
  if (!isSelectionUsable(sel)) return null;
  const deg = clampNum(degrees, -3600, 3600, 0);
  if (deg === 0 || (sel!.invert && sel!.subpaths.length === 0)) return sel;
  const center = selectionCentroidNorm(sel);
  if (!center) return sel;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const aspect = opts?.aspect ?? 1;
  const nextSubs: SelectionSubpath[] = [];
  for (const sp of sel!.subpaths) {
    const points = sp.points.map((p) => rotateNormPoint(p, center.x, center.y, cos, sin, aspect));
    if (sp.kind === "brush") {
      if (points.length === 0) continue;
      nextSubs.push({ ...sp, points });
      continue;
    }
    if (points.length >= 3 && polygonAreaNorm(points) >= MIN_SELECTION_SUBPATH_AREA) {
      nextSubs.push({ mode: sp.mode, points });
    }
  }
  if (nextSubs.length === 0 && !sel!.invert) return null;
  return { ...sel!, subpaths: nextSubs };
}

/**
 * 선택 마퀴 좌우/상하 반전 — 중심 기준. 픽셀 내용은 유지하고 경계만 뒤집는다.
 * axis "x" = 좌우, "y" = 상하.
 */
export function flipSelection(sel: PixelSelection | null, axis: "x" | "y"): PixelSelection | null {
  if (!isSelectionUsable(sel)) return null;
  if (sel!.invert && sel!.subpaths.length === 0) return sel;
  const center = selectionCentroidNorm(sel);
  if (!center) return sel;
  const nextSubs: SelectionSubpath[] = [];
  for (const sp of sel!.subpaths) {
    const points = sp.points.map((p) =>
      sanitizePoint(
        axis === "x" ? { x: 2 * center.x - p.x, y: p.y } : { x: p.x, y: 2 * center.y - p.y },
        SEL_POINT_MIN,
        SEL_POINT_MAX
      )
    );
    if (sp.kind === "brush") {
      if (points.length === 0) continue;
      nextSubs.push({ ...sp, points });
      continue;
    }
    if (points.length >= 3 && polygonAreaNorm(points) >= MIN_SELECTION_SUBPATH_AREA) {
      nextSubs.push({ mode: sp.mode, points });
    }
  }
  if (nextSubs.length === 0 && !sel!.invert) return null;
  return { ...sel!, subpaths: nextSubs };
}

/**
 * 선택 마퀴 이동(선택 안을 드래그) — 픽셀 내용은 유지하고 경계만 평행 이동.
 * dx/dy 는 정규화 단위. 전체 반전(서브패스 0)은 이동 의미 없어 그대로 반환.
 */
export function translateSelection(
  sel: PixelSelection | null,
  dx: number,
  dy: number
): PixelSelection | null {
  if (!isSelectionUsable(sel)) return null;
  if (sel!.invert && sel!.subpaths.length === 0) return sel;
  const ox = clampNum(dx, -2, 2, 0);
  const oy = clampNum(dy, -2, 2, 0);
  if (ox === 0 && oy === 0) return sel;
  const nextSubs: SelectionSubpath[] = [];
  for (const sp of sel!.subpaths) {
    const points = sp.points.map((p) =>
      sanitizePoint({ x: p.x + ox, y: p.y + oy }, SEL_POINT_MIN, SEL_POINT_MAX)
    );
    if (sp.kind === "brush") {
      if (points.length === 0) continue;
      nextSubs.push({ ...sp, points });
      continue;
    }
    if (points.length >= 3 && polygonAreaNorm(points) >= MIN_SELECTION_SUBPATH_AREA) {
      nextSubs.push({ mode: sp.mode, points });
    }
  }
  if (nextSubs.length === 0 && !sel!.invert) return null;
  return { ...sel!, subpaths: nextSubs };
}

/** 선택 마퀴 스케일(중심 기준). factor=1 불변, 0.5=절반. 브러시 반경도 같이 스케일. */
export function scaleSelection(
  sel: PixelSelection | null,
  factor: number,
  opts?: { aspect?: number }
): PixelSelection | null {
  if (!isSelectionUsable(sel)) return null;
  const f = clampNum(factor, 0.05, 8, 1);
  if (f === 1 || (sel!.invert && sel!.subpaths.length === 0)) return sel;
  const center = selectionCentroidNorm(sel);
  if (!center) return sel;
  const aspect = opts?.aspect ?? 1;
  const A = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const nextSubs: SelectionSubpath[] = [];
  for (const sp of sel!.subpaths) {
    const points = sp.points.map((p) => {
      const sx = p.x - center.x;
      const sy = (p.y - center.y) * A;
      return sanitizePoint(
        { x: center.x + sx * f, y: center.y + (sy * f) / A },
        SEL_POINT_MIN,
        SEL_POINT_MAX
      );
    });
    if (sp.kind === "brush") {
      const radius = clampNum(sp.radius * f, 0.001, MAX_BRUSH_RADIUS_NORM);
      if (points.length === 0 || radius < 0.001) continue;
      nextSubs.push({ ...sp, points, radius });
      continue;
    }
    if (points.length >= 3 && polygonAreaNorm(points) >= MIN_SELECTION_SUBPATH_AREA) {
      nextSubs.push({ mode: sp.mode, points });
    }
  }
  if (nextSubs.length === 0 && !sel!.invert) return null;
  return { ...sel!, subpaths: nextSubs };
}

/** 선택 내용 변형(Transform) — 픽셀을 이동/회전/스케일/반전(원본 선택 영역은 지우고 변형본을 얹음). */
export type SelectionContentTransform = {
  /** 디바이스 px 평행 이동. */
  dxPx?: number;
  dyPx?: number;
  /** 시계 방향 도. */
  rotateDeg?: number;
  /** 균일 스케일(1=불변). */
  scale?: number;
  flipX?: boolean;
  flipY?: boolean;
};

/** 내용 변형이 실질 no-op 인지. */
export function isSelectionContentTransformNoop(t: SelectionContentTransform): boolean {
  const dx = t.dxPx ?? 0;
  const dy = t.dyPx ?? 0;
  const rot = t.rotateDeg ?? 0;
  const sc = t.scale ?? 1;
  return (
    (!Number.isFinite(dx) || dx === 0) &&
    (!Number.isFinite(dy) || dy === 0) &&
    (!Number.isFinite(rot) || rot === 0) &&
    (!Number.isFinite(sc) || sc === 1) &&
    !t.flipX &&
    !t.flipY
  );
}

/**
 * 마퀴 기하에 내용 변형과 같은 변환을 적용 — 변형 후 선택이 픽셀을 따라가도록.
 * dx/dy 는 정규화(디바이스 px ÷ 폭/높이로 환산해 호출).
 */
export function transformSelectionMarquee(
  sel: PixelSelection | null,
  t: {
    dxNorm?: number;
    dyNorm?: number;
    rotateDeg?: number;
    scale?: number;
    flipX?: boolean;
    flipY?: boolean;
    aspect?: number;
  }
): PixelSelection | null {
  if (!isSelectionUsable(sel)) return null;
  let next: PixelSelection | null = sel;
  const sc = t.scale ?? 1;
  if (sc !== 1) next = scaleSelection(next, sc, { aspect: t.aspect });
  if (t.flipX) next = flipSelection(next, "x");
  if (t.flipY) next = flipSelection(next, "y");
  const rot = t.rotateDeg ?? 0;
  if (rot !== 0) next = rotateSelection(next, rot, { aspect: t.aspect });
  const dx = t.dxNorm ?? 0;
  const dy = t.dyNorm ?? 0;
  if (dx !== 0 || dy !== 0) next = translateSelection(next, dx, dy);
  return next;
}

/**
 * 원본 + 마스크 + 내용 변형 → 결과 캔버스.
 * 1) 마스크 영역을 원본에서 지우고 2) 마스크로 오린 조각을 중심 기준으로 변형해 다시 그린다.
 * 선택 내용 변형(Scale/Rotate/Flip/Move)의 비대화형 적용 경로.
 */
export function applySelectionContentTransformToCanvas(
  source: MaskImageSource,
  width: number,
  height: number,
  mask: MaskImageSource,
  transform: SelectionContentTransform,
  createCanvas: SelectionCanvasFactory,
  boundsPx?: { x: number; y: number; w: number; h: number }
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (isSelectionContentTransformNoop(transform)) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const dx = clampNum(transform.dxPx ?? 0, -w * 2, w * 2, 0);
  const dy = clampNum(transform.dyPx ?? 0, -h * 2, h * 2, 0);
  const rot = clampNum(transform.rotateDeg ?? 0, -3600, 3600, 0);
  const scale = clampNum(transform.scale ?? 1, 0.05, 8, 1);
  const flipX = !!transform.flipX;
  const flipY = !!transform.flipY;

  // 중심: 호출자가 준 bbox 또는 전체 캔버스 중심.
  let cx = w / 2;
  let cy = h / 2;
  if (boundsPx && Number.isFinite(boundsPx.w) && Number.isFinite(boundsPx.h) && boundsPx.w > 0 && boundsPx.h > 0) {
    cx = boundsPx.x + boundsPx.w / 2;
    cy = boundsPx.y + boundsPx.h / 2;
  }

  const piece = createCanvas(w, h);
  if (!piece) return null;
  piece.ctx.drawImage(source, 0, 0);
  piece.ctx.globalCompositeOperation = "destination-in";
  piece.ctx.drawImage(mask, 0, 0);
  piece.ctx.globalCompositeOperation = "source-over";

  const out = createCanvas(w, h);
  if (!out) return null;
  out.ctx.drawImage(source, 0, 0);
  out.ctx.globalCompositeOperation = "destination-out";
  out.ctx.drawImage(mask, 0, 0);
  out.ctx.globalCompositeOperation = "source-over";

  // 구조 타입 가드 — 실제 CanvasRenderingContext2D 는 전부 구현. 테스트 픽스처도 save 계열을 채운다.
  if (!out.ctx.save || !out.ctx.restore || !out.ctx.translate || !out.ctx.rotate || !out.ctx.scale) {
    return null;
  }
  out.ctx.save();
  out.ctx.translate(cx + dx, cy + dy);
  out.ctx.rotate((rot * Math.PI) / 180);
  out.ctx.scale(scale * (flipX ? -1 : 1), scale * (flipY ? -1 : 1));
  out.ctx.translate(-cx, -cy);
  out.ctx.drawImage(piece.canvas, 0, 0);
  out.ctx.restore();
  return out.canvas;
}

// ---------------------------------------------------------------------------
// 다각형 올가미(클릭-꼭짓점) 세션 — 드래그 올가미와 분리된 상태 기계
// ---------------------------------------------------------------------------

export type PolyLassoSession = {
  mode: SelectionCombineMode;
  points: SelPoint[];
};

export function beginPolyLassoSession(mode: SelectionCombineMode, p: SelPoint): PolyLassoSession {
  return { mode, points: [sanitizePoint(p, SEL_POINT_MIN, SEL_POINT_MAX)] };
}

export function appendPolyLassoVertex(session: PolyLassoSession, p: SelPoint): PolyLassoSession {
  const points = appendLassoPoint(session.points, p, LASSO_MIN_POINT_DIST * 2);
  return points === session.points ? session : { ...session, points };
}

/** 닫기 확정 — 점 ≥3 이고 면적 충분하면 선택에 결합. */
export function commitPolyLassoSession(
  sel: PixelSelection | null,
  session: PolyLassoSession
): PixelSelection | null {
  return addSelectionSubpath(sel, session.mode, session.points);
}

/** 시작점에 가깝게 다시 클릭했는지 — 닫기 제스처 힌트. */
export function polyLassoCloseToStart(session: PolyLassoSession, p: SelPoint, threshold = 0.03): boolean {
  const first = session.points[0];
  if (!first || session.points.length < 3) return false;
  const dx = p.x - first.x;
  const dy = p.y - first.y;
  return dx * dx + dy * dy <= threshold * threshold;
}

/**
 * 브러시 서브패스 추가 — 점 1개(탭 = 반경만큼 점 찍기)도 유효하다(폴리곤과 달리 면적 문턱 없음).
 * 반경이 0 이하·비유한이거나 점이 없으면 아무것도 칠할 수 없으므로 기존 선택을 그대로 반환.
 */
export function addBrushSubpath(
  sel: PixelSelection | null,
  mode: SelectionCombineMode,
  points: readonly SelPoint[],
  radiusNorm: number
): PixelSelection | null {
  const radius = clampNum(radiusNorm, 0, MAX_BRUSH_RADIUS_NORM);
  if (points.length === 0 || radius <= 0) return sel;
  const clean = points.map((p) => sanitizePoint(p, SEL_POINT_MIN, SEL_POINT_MAX));
  if (mode === "intersect") {
    // Approximate brush ∩ old selection by converting stroke to a thick polygon hull (bbox + radius).
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const p of clean) {
      if (p.x - radius < minX) minX = p.x - radius;
      if (p.y - radius < minY) minY = p.y - radius;
      if (p.x + radius > maxX) maxX = p.x + radius;
      if (p.y + radius > maxY) maxY = p.y + radius;
    }
    const hull = rectSelectionPolygon(
      { x: Math.max(0, minX), y: Math.max(0, minY) },
      { x: Math.min(1, maxX), y: Math.min(1, maxY) }
    );
    return intersectSelectionWithPolygon(sel, hull);
  }
  const base = sel ?? emptyPixelSelection();
  return { ...base, subpaths: [...base.subpaths, { mode, kind: "brush", points: clean, radius }] };
}

/** 마지막 서브패스 한 단계 되돌리기 — 남는 게 없고 반전도 없으면 null(선택 해제). */
export function removeLastSubpath(sel: PixelSelection): PixelSelection | null {
  if (sel.subpaths.length === 0) return sel.invert ? sel : null;
  const subpaths = sel.subpaths.slice(0, -1);
  if (subpaths.length === 0 && !sel.invert) return null;
  return { ...sel, subpaths };
}

/** 페더(px) 설정 — 범위 클램프 + 정수 반올림. */
export function setSelectionFeather(sel: PixelSelection, px: number): PixelSelection {
  return { ...sel, featherPx: Math.round(clampNum(px, SELECTION_FEATHER_RANGE.min, SELECTION_FEATHER_RANGE.max)) };
}

/** 반전 토글 — 서브패스 0개 + 반전 = 전체 선택(Ctrl+A 상당). */
export function toggleSelectionInvert(sel: PixelSelection): PixelSelection {
  return { ...sel, invert: !sel.invert };
}

/** 조정을 가할 수 있는 선택인지 — 반전이거나, 합치기 서브패스가 1개 이상. */
export function isSelectionUsable(sel: PixelSelection | null): boolean {
  if (!sel) return false;
  return sel.invert || sel.subpaths.some((sp) => sp.mode === "add");
}

/**
 * 점이 최종 선택 영역 안인지 — 래스터와 동일한 "마지막 덮는 서브패스" 의미론 + 반전.
 * (fill 은 폴리곤 안을 불투명으로, erase 는 투명으로 만들므로 마지막 서브패스가 이긴다.)
 * opts.aspect: 브러시 원형 판정용 세로/가로 px 비(기본 1) — pointOnBrushSubpath 참고.
 */
export function pointInSelection(sel: PixelSelection | null, p: SelPoint, opts?: { aspect?: number }): boolean {
  if (!sel) return false;
  let inside = false;
  for (const sp of sel.subpaths) {
    const hit = sp.kind === "brush" ? pointOnBrushSubpath(p, sp, opts?.aspect ?? 1) : pointInPolygon(p, sp.points);
    if (hit) inside = sp.mode === "add";
  }
  return sel.invert ? !inside : inside;
}

/** 선택 영역의 정규화 bbox — 반전이면 전체 박스, 쓸 수 없는 선택이면 null. */
export function selectionBoundsNorm(sel: PixelSelection | null): { x: number; y: number; w: number; h: number } | null {
  if (!isSelectionUsable(sel)) return null;
  if (sel!.invert) return { x: 0, y: 0, w: 1, h: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const sp of sel!.subpaths) {
    if (sp.mode !== "add") continue; // 빼기는 영역을 넓히지 못한다.
    // 브러시는 궤적에서 반경만큼 부풀린다(y 도 폭 정규화 반경 그대로 — 약간 과대평가 근사).
    const r = sp.kind === "brush" ? clampNum(sp.radius, 0, MAX_BRUSH_RADIUS_NORM) : 0;
    for (const p of sp.points) {
      minX = Math.min(minX, p.x - r);
      minY = Math.min(minY, p.y - r);
      maxX = Math.max(maxX, p.x + r);
      maxY = Math.max(maxY, p.y + r);
    }
  }
  const x = clampNum(minX, 0, 1);
  const y = clampNum(minY, 0, 1);
  return { x, y, w: clampNum(maxX, 0, 1) - x, h: clampNum(maxY, 0, 1) - y };
}

// ---------------------------------------------------------------------------
// (4) 드래그 세션 — StudioPage 포인터 핸들러가 쓰는 얇은 순수 리듀서
// ---------------------------------------------------------------------------

/** 진행 중 드래그 상태 — points 는 실시간 미리보기 폴리곤/궤적(정규화)으로 바로 그릴 수 있다. */
export type SelectionDragState = {
  tool: SelectionToolKind;
  mode: SelectionCombineMode;
  start: SelPoint;
  points: SelPoint[];
  /** 브러시 전용 — 정규화 반경(요소 폭 대비). 다른 도구는 0. */
  brushRadius: number;
  /** 정원/정사각 강제 (원형 선택 도구 또는 Shift). */
  forceCircle?: boolean;
};

export type SelectionDragModifiers = {
  shift?: boolean;
  alt?: boolean;
  /** 요소 height/width — 화면상 정원 보정. */
  aspect?: number;
  /**
   * 자석 올가미 휘도장 — lasso/poly-lasso 궤적 누적 시 각 점을 가까운 휘도 가장자리로
   * 스냅한다(자석 올가미). null/미설정이면 일반 올가미와 동일(스냅 없음).
   */
  magneticField?: SelectionLuminanceField | null;
};

/**
 * 제스처 "시작" 수정자 → 결합 모드 오버라이드(Photoshop/CSP 관례 — 2026-07-24).
 * 기존 선택이 있을 때만 Shift=합치기, Alt=빼기, Shift+Alt=교집합으로 덮어쓴다 —
 * 선택이 없으면 Shift/Alt 는 오늘처럼 정사각(Shift)/중심 확장(Alt) 제약 의미를 유지한다
 * (Photoshop 도 선택이 없으면 Shift 를 비율 제약으로 해석한다). 드래그 "중" 수정자는
 * 계속 updateSelectionDrag 의 정원/중심 제약에만 쓰인다 — 두 의미가 공존한다.
 */
export function resolveSelectionCombineOverride(
  base: SelectionOperationMode,
  mods: { shift?: boolean; alt?: boolean },
  hasExistingSelection: boolean
): SelectionOperationMode {
  if (!hasExistingSelection) return base;
  if (mods.shift && mods.alt) return "intersect";
  if (mods.shift) return "add";
  if (mods.alt) return "subtract";
  return base;
}

/**
 * Magma Selection-tool semantics: click-drag *inside* an existing marquee (without Shift/Alt
 * add·subtract·intersect override) moves only the outline, not the pixels. Content moves via
 * Transform (Shift+T in Magma) / content-transform actions in Studio.
 */
export function shouldMoveSelectionMarquee(input: {
  readonly hasUsableSelection: boolean;
  readonly pointInside: boolean;
  /** Result of {@link resolveSelectionCombineOverride} for this pointer-down. */
  readonly operationMode: SelectionOperationMode;
}): boolean {
  return (
    input.hasUsableSelection
    && input.pointInside
    && input.operationMode === "replace"
  );
}

/**
 * 드래그 시작 — rect/ellipse 는 퇴화 폴리곤(면적 0), lasso/brush 는 시작점 1개로 초기화한다.
 * poly-lasso 는 클릭 세션(beginPolyLassoSession)을 쓰므로 여기로 오지 않는다.
 * brushRadiusNorm: 브러시 도구의 정규화 반경(캔버스 px ÷ 요소 폭). 다른 도구는 무시된다.
 */
export function beginSelectionDrag(
  tool: SelectionToolKind,
  mode: SelectionCombineMode,
  p: SelPoint,
  brushRadiusNorm = 0,
  opts?: { forceCircle?: boolean }
): SelectionDragState {
  const start = sanitizePoint(p, SEL_POINT_MIN, SEL_POINT_MAX);
  // poly-lasso treated as freehand lasso if drag path is used by mistake
  const freehand = tool === "lasso" || tool === "poly-lasso" || tool === "brush";
  const points = freehand ? [start] : rectSelectionPolygon(start, start);
  const brushRadius = tool === "brush" ? clampNum(brushRadiusNorm, 0, MAX_BRUSH_RADIUS_NORM) : 0;
  return { tool, mode, start, points, brushRadius, forceCircle: !!opts?.forceCircle };
}

/** 드래그 이동 — rect/ellipse 는 시작→현재 박스로 재계산(+Shift/Alt), lasso/brush 는 궤적 누적. */
export function updateSelectionDrag(
  drag: SelectionDragState,
  p: SelPoint,
  mods?: SelectionDragModifiers
): SelectionDragState {
  if (drag.tool === "lasso" || drag.tool === "poly-lasso" || drag.tool === "brush") {
    const points =
      drag.tool === "brush"
        ? appendBrushPoint(drag.points, p, drag.brushRadius)
        : mods?.magneticField
          ? appendMagneticLassoPoint(drag.points, p, mods.magneticField)
          : appendLassoPoint(drag.points, p);
    return points === drag.points ? drag : { ...drag, points };
  }
  const corners = constrainSelectionDragCorners(drag.start, p, {
    shift: mods?.shift,
    alt: mods?.alt,
    aspect: mods?.aspect,
    forceCircle: drag.forceCircle || (drag.tool === "ellipse" && mods?.shift),
  });
  const points =
    drag.tool === "rect"
      ? rectSelectionPolygon(corners.a, corners.b)
      : ellipseSelectionPolygon(corners.a, corners.b);
  return { ...drag, points };
}

/**
 * 드래그 확정 — 올가미는 단순화 후 서브패스로 결합. 면적이 무의미하면 null(변화 없음 신호).
 * 브러시는 탭(점 1개)도 유효하나 반경 0 이면 null. 반환값이 null 이 아니면 그대로 set 하면 된다.
 */
export function commitSelectionDrag(sel: PixelSelection | null, drag: SelectionDragState): PixelSelection | null {
  if (drag.tool === "brush") {
    const next = addBrushSubpath(sel, drag.mode, drag.points, drag.brushRadius);
    return next === sel ? null : next;
  }
  const points =
    drag.tool === "lasso" || drag.tool === "poly-lasso"
      ? simplifyLassoPolygon(drag.points)
      : drag.points;
  if (points.length < 3 || polygonAreaNorm(points) < MIN_SELECTION_SUBPATH_AREA) return null;
  const next = addSelectionSubpath(sel, drag.mode, points);
  return next === sel ? null : next;
}

/**
 * Finalizes a drag from the release sample itself.
 *
 * Browsers may coalesce a short press-drag-release into pointerdown + pointerup without delivering
 * pointermove. Replaying the release point through the same reducer prevents rect/ellipse from
 * remaining a zero-area polygon and also preserves the last lasso/brush segment.
 */
export function commitSelectionDragAtPoint(
  sel: PixelSelection | null,
  drag: SelectionDragState,
  releasePoint: SelPoint,
  modifiers?: SelectionDragModifiers,
): PixelSelection | null {
  return commitSelectionDrag(sel, updateSelectionDrag(drag, releasePoint, modifiers));
}

// ---------------------------------------------------------------------------
// (5) 좌표 변환 — 캔버스 포인터 ↔ 정규화 (요소 회전 포함)
// ---------------------------------------------------------------------------

/** 이미지 요소 배치 프레임 — Konva 노드와 동일하게 회전은 좌상단(x,y) 기준 도(deg). */
export type SelectionFrame = { x: number; y: number; width: number; height: number; rotation?: number };

/** 캔버스 좌표 → 정규화 좌표 — 요소 역변환(이동→역회전→크기 나눔). 클램프하지 않는다. */
export function canvasPointToNormalized(px: number, py: number, frame: SelectionFrame): SelPoint {
  const w = Number.isFinite(frame.width) && frame.width !== 0 ? frame.width : 1;
  const h = Number.isFinite(frame.height) && frame.height !== 0 ? frame.height : 1;
  const dx = px - frame.x;
  const dy = py - frame.y;
  const theta = ((frame.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // R(-θ)·(p - t): 회전된 요소 위 포인터를 비회전 로컬로 되돌린다.
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return { x: clampNum(lx / w, -1e6, 1e6), y: clampNum(ly / h, -1e6, 1e6) };
}

// ---------------------------------------------------------------------------
// (5b) arm-anytime 자동 대상 획득 — 포인터 아래 최상단 이미지 결정(순수, 2026-07-24)
// ---------------------------------------------------------------------------

/**
 * 자동 대상 후보 — z순서 아래→위(캔버스 렌더 순서 그대로) 배열로 넘긴다.
 * hidden/locked 평가(그룹 상속 포함)는 호출자(StudioPage)가 미리 끝내서 넣는다.
 */
export type PixelSelectionAutoTargetCandidate = {
  id: string;
  frame: SelectionFrame;
  hidden?: boolean;
  locked?: boolean;
};

/**
 * 자동 대상 결정 결과.
 *  - target: 히트한 최상단의 편집 가능 이미지.
 *  - locked: 편집 가능 히트가 없고 잠긴 이미지만 히트 — 최상단 잠긴 id(잠금 안내 문구용).
 *  - none  : 포인터 아래에 보이는 이미지가 없음(죽은 클릭 안내용).
 */
export type PixelSelectionAutoTargetResolution =
  | { kind: "target"; id: string }
  | { kind: "locked"; id: string }
  | { kind: "none" };

/**
 * 픽셀 선택 도구를 이미지 선택 없이 무장(arm-anytime)했을 때, 첫 제스처의 포인터 아래에서
 * 대상 이미지를 자동 획득한다(Photoshop/CSP 관례). 규칙:
 *  - 숨김 후보는 히트 자체가 안 된다(보이지 않으면 고를 수 없다).
 *  - 잠긴 후보는 아래로 통과시킨다(겹친 아래쪽의 편집 가능 이미지를 살린다). 편집 가능 히트가
 *    하나도 없으면 최상단 잠긴 히트를 돌려줘 안내 문구를 띄울 수 있게 한다.
 *  - 회전 요소는 canvasPointToNormalized 의 역회전으로 정확히 히트테스트한다.
 * 결정적: 같은 입력은 항상 같은 결과(순회 순서 고정, 랜덤/Date 없음).
 */
export function resolvePixelSelectionAutoTarget(
  candidates: readonly PixelSelectionAutoTargetCandidate[],
  point: { x: number; y: number }
): PixelSelectionAutoTargetResolution {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { kind: "none" };
  let topLockedHitId: string | null = null;
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i]!;
    if (candidate.hidden) continue;
    const { frame } = candidate;
    if (
      !Number.isFinite(frame.width) || !Number.isFinite(frame.height) ||
      frame.width === 0 || frame.height === 0
    ) {
      continue;
    }
    const p = canvasPointToNormalized(point.x, point.y, frame);
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
    if (candidate.locked) {
      topLockedHitId ??= candidate.id;
      continue;
    }
    return { kind: "target", id: candidate.id };
  }
  return topLockedHitId !== null ? { kind: "locked", id: topLockedHitId } : { kind: "none" };
}

// ---------------------------------------------------------------------------
// (5c) 자석 올가미 — 휘도장 기반 가장자리 스냅(순수, 픽셀 샘플러 주입 · 2026-07-24)
// ---------------------------------------------------------------------------

/** 자석 올가미 휘도장 해상도 상한(긴 변 px) — 스냅 검색용이라 마스크 추적보다 낮아도 충분하다. */
export const MAGNETIC_LASSO_FIELD_MAX_DIM = 320;
/** 스냅 검색 반경(휘도장 px) — 이 안에서 가장 강한 가장자리로 끌어당긴다. */
export const MAGNETIC_LASSO_SEARCH_RADIUS_PX = 10;
/** 가장자리로 인정할 최소 그래디언트 크기(0..255 휘도 차 스케일) — 미만이면 스냅하지 않는다. */
export const MAGNETIC_LASSO_MIN_GRADIENT = 24;

/**
 * 다운스케일 휘도장 — data[y*width+x] = 0..255 휘도. 브라우저 쪽(sampleImageLuminanceField)이
 * 표시 좌표계(요소 flip 반영)로 만들어 주입하므로, 이 코어의 정규화 좌표와 축이 항상 일치한다.
 */
export type SelectionLuminanceField = {
  width: number;
  height: number;
  data: ArrayLike<number>;
};

/** RGBA 평탄 배열 → 휘도장(Rec.601 luma). 길이가 width*height*4 와 안 맞으면 null. */
export function luminanceFieldFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): SelectionLuminanceField | null {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  if (rgba.length < w * h * 4) return null;
  const data = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i += 1) {
    const o = i * 4;
    // Rec.601 — 마술봉/플러드필과 같은 지각 가중치 계열. 알파는 흰 배경 합성으로 근사한다
    // (투명 픽셀이 0(검정)으로 읽혀 실제 콘텐츠 경계보다 강한 가짜 가장자리를 만들지 않도록).
    const a = (rgba[o + 3] ?? 255) / 255;
    const lum =
      0.299 * (rgba[o] ?? 0) + 0.587 * (rgba[o + 1] ?? 0) + 0.114 * (rgba[o + 2] ?? 0);
    data[i] = Math.round(lum * a + 255 * (1 - a));
  }
  return { width: w, height: h, data };
}

/** 휘도장 안전 읽기 — 경계는 복제 패딩(클램프). */
function luminanceAt(field: SelectionLuminanceField, x: number, y: number): number {
  const cx = x < 0 ? 0 : x >= field.width ? field.width - 1 : x;
  const cy = y < 0 ? 0 : y >= field.height ? field.height - 1 : y;
  return Number(field.data[cy * field.width + cx] ?? 0);
}

/** 휘도장 (x,y)의 그래디언트 크기 — 중앙차분 |∂x|+|∂y| (결정적, 경계 복제 패딩). */
export function luminanceFieldGradientAt(field: SelectionLuminanceField, x: number, y: number): number {
  const dx = luminanceAt(field, x + 1, y) - luminanceAt(field, x - 1, y);
  const dy = luminanceAt(field, x, y + 1) - luminanceAt(field, x, y - 1);
  return Math.abs(dx) + Math.abs(dy);
}

/**
 * 자석 올가미 스냅 — 점 주변 검색창(searchRadiusPx)에서 가장 강한 휘도 가장자리 셀로 점을
 * 끌어당긴다. 최강 그래디언트가 minGradient 미만이면 원래 점을 그대로 반환한다(스냅 없음).
 * 타이브레이크(결정적): 그래디언트 큰 쪽 → 원점에 가까운 쪽 → 행 우선(작은 y, 작은 x).
 * 좌표 규약: 셀 i 의 중심 = (i + 0.5) / size — 반환 점도 셀 중심 정규화 좌표다.
 */
export function snapLassoPointToEdge(
  p: SelPoint,
  field: SelectionLuminanceField,
  opts?: { searchRadiusPx?: number; minGradient?: number }
): SelPoint {
  const w = field.width;
  const h = field.height;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return p;
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return p;
  const radius = Math.max(0, Math.round(opts?.searchRadiusPx ?? MAGNETIC_LASSO_SEARCH_RADIUS_PX));
  const minGradient = opts?.minGradient ?? MAGNETIC_LASSO_MIN_GRADIENT;
  const fx = p.x * w - 0.5;
  const fy = p.y * h - 0.5;
  const cx = Math.min(w - 1, Math.max(0, Math.round(fx)));
  const cy = Math.min(h - 1, Math.max(0, Math.round(fy)));
  let bestX = -1;
  let bestY = -1;
  let bestScore = -Infinity;
  let bestDistSq = Infinity;
  for (let y = Math.max(0, cy - radius); y <= Math.min(h - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(w - 1, cx + radius); x += 1) {
      const score = luminanceFieldGradientAt(field, x, y);
      if (score < minGradient) continue;
      const dx = x - fx;
      const dy = y - fy;
      const distSq = dx * dx + dy * dy;
      if (score > bestScore || (score === bestScore && distSq < bestDistSq)) {
        bestScore = score;
        bestDistSq = distSq;
        bestX = x;
        bestY = y;
      }
    }
  }
  if (bestX < 0) return p;
  return { x: (bestX + 0.5) / w, y: (bestY + 0.5) / h };
}

/**
 * 자석 올가미 점 추가 — field 가 있으면 스냅 후 appendLassoPoint 와 동일한 불변 규약으로
 * 궤적에 잇는다(안 늘면 같은 배열). field 가 null 이면(휘도장 로딩 전) 일반 올가미와 동일.
 */
export function appendMagneticLassoPoint(
  points: readonly SelPoint[],
  p: SelPoint,
  field: SelectionLuminanceField | null,
  opts?: { searchRadiusPx?: number; minGradient?: number; minDist?: number }
): SelPoint[] {
  const snapped = field ? snapLassoPointToEdge(p, field, opts) : p;
  return appendLassoPoint(points, snapped, opts?.minDist ?? LASSO_MIN_POINT_DIST);
}

/** 정규화 좌표 → 캔버스 좌표 — canvasPointToNormalized 의 역변환. */
export function normalizedPointToCanvas(p: SelPoint, frame: SelectionFrame): { x: number; y: number } {
  const theta = ((frame.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const lx = p.x * frame.width;
  const ly = p.y * frame.height;
  return { x: frame.x + lx * cos - ly * sin, y: frame.y + lx * sin + ly * cos };
}

/**
 * 서브패스 → 요소 로컬 px 평탄 배열([x0,y0,x1,y1,…]) — Konva Line(points, closed)용.
 * 브러시 서브패스는 궤적 "중심선"을 반환한다(획 폭 미반영) — 마칭앤츠를 중심선에 두르면
 * 어색하므로 브러시 표시는 brushStrokePreview(반투명 획)를 쓰는 것이 표준이다.
 */
export function subpathOutlinePoints(subpath: SelectionSubpath, size: { width: number; height: number }): number[] {
  const out: number[] = [];
  for (const p of subpath.points) {
    out.push(p.x * size.width, p.y * size.height);
  }
  return out;
}

/**
 * 브러시 미리보기 획 기하 — Konva Line(points, strokeWidth, lineCap/Join="round")에 그대로 대응.
 * 오프셋 폴리곤(마칭앤츠) 대신 반투명 라운드 획을 쓰는 이유: 획 기하가 마스크 래스터의
 * 스트로크와 **동일 도형**이라 미리보기=결과가 근사 없이 일치한다(자기교차 궤적도 안전).
 * 점 1개(탭)는 같은 점을 복제해 라운드 캡이 원(점 찍기)을 그리게 한다.
 * 반환 null = 그릴 것 없음(빈 궤적·반경 0·비정상 크기).
 */
export function brushStrokePreview(
  points: readonly SelPoint[],
  radiusNorm: number,
  size: { width: number; height: number }
): { points: number[]; strokeWidth: number } | null {
  const radius = clampNum(radiusNorm, 0, MAX_BRUSH_RADIUS_NORM);
  const w = Number.isFinite(size.width) && size.width > 0 ? size.width : 0;
  const h = Number.isFinite(size.height) && size.height > 0 ? size.height : 0;
  if (radius <= 0 || w <= 0 || h <= 0 || points.length === 0) return null;
  const flat: number[] = [];
  for (const p of points) {
    flat.push(p.x * w, p.y * h);
  }
  if (points.length === 1) flat.push(flat[0]!, flat[1]!);
  return { points: flat, strokeWidth: 2 * radius * w };
}

// ---------------------------------------------------------------------------
// (6) 마칭앤츠 — 대시 오프셋 애니메이션 파라미터
// ---------------------------------------------------------------------------

/**
 * 브러시 선택 미리보기 틴트(결합 모드별) — 브러시 서브패스는 마칭앤츠 대신 이 색의
 * 반투명 획(퀵 마스크식)으로 표시한다. 드래그 미리보기 채움색과 같은 계열(보라/적).
 */
export const BRUSH_PREVIEW_COLORS: Record<SelectionCombineMode, string> = {
  add: "rgba(124, 92, 252, 0.24)",
  subtract: "rgba(244, 63, 94, 0.24)",
  intersect: "rgba(14, 165, 233, 0.24)",
};

/** 마칭앤츠 대시 패턴(px) — [칠함, 빔]. 합(9px)이 한 주기. */
export const MARCHING_ANTS_DASH: readonly [number, number] = [5, 4];
/** 개미 행진 속도(px/초) — 화면 픽셀 기준. */
export const MARCHING_ANTS_SPEED_PX_PER_SEC = 18;

/**
 * 경과시간(ms) → 대시 오프셋(px). 음수 방향(전진)으로 흐르고 주기로 접어 수치가 안 커진다.
 * 결정적: 같은 elapsedMs 는 항상 같은 오프셋(비유한 입력은 0).
 */
export function marchingAntsDashOffset(
  elapsedMs: number,
  speedPxPerSec = MARCHING_ANTS_SPEED_PX_PER_SEC,
  cyclePx = MARCHING_ANTS_DASH[0] + MARCHING_ANTS_DASH[1]
): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(speedPxPerSec) || !Number.isFinite(cyclePx) || cyclePx <= 0) {
    return 0;
  }
  const offset = -(((elapsedMs / 1000) * speedPxPerSec) % cyclePx);
  return offset === 0 ? 0 : offset; // -0 정규화
}

/** 마칭앤츠 한 획 파라미터 — Konva Line 의 stroke/dash/dashOffset/strokeWidth 에 대응. */
export type MarchingAntsPass = {
  stroke: string;
  dash: [number, number] | null; // null = 실선(밑줄 패스)
  dashOffset: number;
  strokeWidth: number;
};

/**
 * 마칭앤츠 2패스 — 흰 실선 밑줄 + 어두운 대시(행진)로 어떤 배경에서도 보인다.
 * scale 은 스테이지 줌(effScale) — 화면 px 두께가 일정하도록 나눠 준다.
 */
export function marchingAntsPasses(elapsedMs: number, scale = 1): MarchingAntsPass[] {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const width = 1.6 / s;
  return [
    { stroke: "#ffffff", dash: null, dashOffset: 0, strokeWidth: width },
    {
      stroke: "#18181b",
      dash: [MARCHING_ANTS_DASH[0] / s, MARCHING_ANTS_DASH[1] / s],
      dashOffset: marchingAntsDashOffset(elapsedMs) / s,
      strokeWidth: width,
    },
  ];
}

// ---------------------------------------------------------------------------
// (7) 마스크 래스터화 — 파라미터 계산(순수) + ctx 실행(구조 타입 주입)
// ---------------------------------------------------------------------------

/**
 * 마스크 그리기 한 단계 — 디바이스 px 좌표를 fill(합치기)/erase(빼기)로 칠한다.
 * strokeWidth 가 있으면(브러시) 폴리곤 채움 대신 라운드 캡/조인 폴리라인 스트로크.
 */
export type SelectionMaskStep = { op: "fill" | "erase"; points: [number, number][]; strokeWidth?: number };

/** 오프스크린 알파 마스크 래스터화 계획 — 계산은 순수, 실행은 ctx 주입. */
export type SelectionMaskPlan = {
  /** 마스크 캔버스 크기(원본 이미지 px). */
  width: number;
  height: number;
  /** 서브패스 순서 그대로의 그리기 단계. */
  steps: SelectionMaskStep[];
  /** 디바이스 px 로 환산된 페더 blur 반경(0=하드 엣지). */
  featherPx: number;
  /** 마지막에 알파 반전 여부. */
  invert: boolean;
};

/**
 * 선택 → 마스크 래스터화 계획.
 * @param imageW/imageH 원본(자연) 픽셀 크기 — 마스크 캔버스 크기가 된다.
 * @param opts.featherScale 표시 px→디바이스 px 환산 배율(예: naturalWidth / el.width). 기본 1.
 * @param opts.flipX/flipY 요소가 좌우/상하 반전 표시 중이면 true — 선택은 화면(반전된 모습)
 *        기준으로 그려지므로 원본 픽셀에 적용하려면 마스크 좌표를 되반전해야 한다.
 */
export function buildSelectionMaskPlan(
  sel: PixelSelection | null,
  imageW: number,
  imageH: number,
  opts?: { featherScale?: number; flipX?: boolean; flipY?: boolean }
): SelectionMaskPlan | null {
  if (!isSelectionUsable(sel)) return null;
  if (!Number.isFinite(imageW) || !Number.isFinite(imageH) || imageW <= 0 || imageH <= 0) return null;
  const width = Math.max(1, Math.round(imageW));
  const height = Math.max(1, Math.round(imageH));
  const rawScale = opts?.featherScale;
  const featherScale = Number.isFinite(rawScale) && rawScale! > 0 ? rawScale! : 1;
  const featherPx = clampNum(Math.round(sel!.featherPx * featherScale * 10) / 10, 0, MAX_DEVICE_FEATHER_PX);
  const steps: SelectionMaskStep[] = [];
  for (const sp of sel!.subpaths) {
    const op: "fill" | "erase" = sp.mode === "add" ? "fill" : "erase";
    const points = sp.points.map((p): [number, number] => {
      const x = p.x * width;
      const y = p.y * height;
      return [opts?.flipX ? width - x : x, opts?.flipY ? height - y : y];
    });
    if (sp.kind === "brush") {
      // 브러시 획 굵기 = 2×반경×마스크 폭(반경이 폭 정규화라 페더 환산과 같은 축).
      // 반전(flip)은 점대칭 도형인 획에 영향 없음. 반경 0 은 칠할 게 없어 계획에서 제외
      // (pointInSelection 의 "반경 0 = 히트 없음"과 일치).
      const strokeWidth = 2 * clampNum(sp.radius, 0, MAX_BRUSH_RADIUS_NORM) * width;
      if (strokeWidth > 0 && points.length > 0) steps.push({ op, points, strokeWidth });
      continue;
    }
    steps.push({ op, points });
  }
  return { width, height, steps, featherPx, invert: sel!.invert };
}

/** drawImage 소스의 최소 표현 — 실제로는 HTMLCanvasElement/HTMLImageElement 등. */
export type MaskImageSource = object;

/** 캔버스의 최소 구조 — 크기만 요구(실제로는 HTMLCanvasElement). */
export type MaskCanvasLike = { width: number; height: number };

/**
 * 2D 컨텍스트 최소 구조 타입 — 마스크/조정 합성에 필요한 멤버만.
 * 실제 CanvasRenderingContext2D 가 그대로 대입된다(메서드 바이베리언스 — 테스트에서 컴파일 검증).
 */
export type MaskCtx2DLike = {
  fillStyle: unknown;
  strokeStyle: unknown;
  globalCompositeOperation: string;
  filter: string;
  lineWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "round" | "bevel" | "miter";
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(fillRule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: MaskImageSource, dx: number, dy: number): void;
  /** 내용 변형(Transform)용 — Canvas 2D 와 동일 계약. 마스크 래스터 경로에서는 쓰지 않아도 된다. */
  save?(): void;
  restore?(): void;
  translate?(x: number, y: number): void;
  rotate?(angleRad: number): void;
  scale?(x: number, y: number): void;
};

/** 오프스크린 캔버스 팩토리 — DOM 의존부를 호출자(StudioPage)가 주입한다. */
export type SelectionCanvasFactory = (
  width: number,
  height: number
) => { canvas: MaskCanvasLike & MaskImageSource; ctx: MaskCtx2DLike } | null;

/**
 * 계획의 steps 를 ctx 에 하드 엣지로 칠한다(feather/invert 이전 단계).
 * fill=source-over 흰색, erase=destination-out. 폴리곤은 evenodd 채움, strokeWidth 가 있는
 * 단계(브러시)는 라운드 캡/조인 스트로크 — 점 1개는 제자리 lineTo 로 라운드 캡 원(점 찍기).
 * 끝나면 합성 모드를 원복한다.
 */
export function paintSelectionMaskSteps(ctx: MaskCtx2DLike, plan: SelectionMaskPlan): void {
  ctx.clearRect(0, 0, plan.width, plan.height);
  ctx.fillStyle = "#ffffff";
  for (const step of plan.steps) {
    if (step.strokeWidth !== undefined) {
      if (!(step.strokeWidth > 0) || step.points.length === 0) continue; // 방어 — 퇴화 획은 건너뜀
      ctx.globalCompositeOperation = step.op === "fill" ? "source-over" : "destination-out";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = step.strokeWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(step.points[0]![0], step.points[0]![1]);
      if (step.points.length === 1) ctx.lineTo(step.points[0]![0], step.points[0]![1]);
      for (let i = 1; i < step.points.length; i += 1) {
        ctx.lineTo(step.points[i]![0], step.points[i]![1]);
      }
      ctx.stroke();
      continue;
    }
    if (step.points.length < 3) continue; // 방어 — 퇴화 폴리곤은 건너뜀
    ctx.globalCompositeOperation = step.op === "fill" ? "source-over" : "destination-out";
    ctx.beginPath();
    ctx.moveTo(step.points[0]![0], step.points[0]![1]);
    for (let i = 1; i < step.points.length; i += 1) {
      ctx.lineTo(step.points[i]![0], step.points[i]![1]);
    }
    ctx.closePath();
    ctx.fill("evenodd");
  }
  ctx.globalCompositeOperation = "source-over";
}

/**
 * 계획 → 알파 마스크 캔버스. 하드 마스크 → (feather 면) 전체 blur → (invert 면) 알파 반전.
 * 흰색(alpha=1) = 선택됨. 팩토리가 null 을 주면 중단하고 null.
 */
export function rasterizeSelectionMask(
  plan: SelectionMaskPlan,
  createCanvas: SelectionCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  const base = createCanvas(plan.width, plan.height);
  if (!base) return null;
  paintSelectionMaskSteps(base.ctx, plan);
  let current = base.canvas;
  if (plan.featherPx > 0) {
    const soft = createCanvas(plan.width, plan.height);
    if (!soft) return null;
    soft.ctx.filter = `blur(${plan.featherPx}px)`;
    soft.ctx.drawImage(current, 0, 0);
    soft.ctx.filter = "none";
    current = soft.canvas;
  }
  if (plan.invert) {
    const inverted = createCanvas(plan.width, plan.height);
    if (!inverted) return null;
    inverted.ctx.fillStyle = "#ffffff";
    inverted.ctx.fillRect(0, 0, plan.width, plan.height);
    inverted.ctx.globalCompositeOperation = "destination-out";
    inverted.ctx.drawImage(current, 0, 0);
    inverted.ctx.globalCompositeOperation = "source-over";
    current = inverted.canvas;
  }
  return current;
}

// ---------------------------------------------------------------------------
// (8) 선택 영역 한정 조정 planner — 밝기/색조/삭제
// ---------------------------------------------------------------------------

/** 선택 영역에 가할 조정 종류. */
export type SelectionAdjustKind = "brightness" | "hue" | "delete";

/** 조정 실행 계획 — cssFilter 는 ctx.filter 문자열(삭제는 null). */
export type SelectionAdjustPlan =
  | { kind: "delete"; cssFilter: null }
  | { kind: "brightness" | "hue"; amount: number; cssFilter: string };

/** 소수점 노이즈 없는 수 문자열(최대 3자리). */
function fmt(n: number): string {
  return String(Number(n.toFixed(3)));
}

/** 조정 종류+양 → 실행 계획. 양은 범위로 클램프·반올림된다. */
export function planSelectionAdjust(kind: SelectionAdjustKind, amount = 0): SelectionAdjustPlan {
  if (kind === "delete") return { kind: "delete", cssFilter: null };
  if (kind === "brightness") {
    const amt = Math.round(clampNum(amount, SELECTION_BRIGHTNESS_RANGE.min, SELECTION_BRIGHTNESS_RANGE.max));
    return { kind, amount: amt, cssFilter: `brightness(${fmt(1 + amt / 100)})` };
  }
  const amt = Math.round(clampNum(amount, SELECTION_HUE_RANGE.min, SELECTION_HUE_RANGE.max));
  return { kind: "hue", amount: amt, cssFilter: `hue-rotate(${amt}deg)` };
}

/** 아무 변화도 없는 계획인지(밝기 0/색조 0) — 패널이 적용 버튼을 비활성화할 때 사용. */
export function isSelectionAdjustNoop(plan: SelectionAdjustPlan): boolean {
  return plan.kind !== "delete" && plan.amount === 0;
}

/**
 * 원본 이미지 + 마스크 + 계획 → 조정 결과 캔버스.
 *   삭제:      결과 = 원본 그대로 그린 뒤 destination-out 으로 마스크 영역 알파 제거.
 *   밝기/색조: (a) 전체에 cssFilter 적용본을 만들고 (b) destination-in 으로 마스크 안만 남긴 뒤
 *              (c) 원본 위에 얹는다 — 페더의 부분 알파가 자연스러운 경계 블렌딩이 된다.
 * source 는 마스크와 같은 픽셀 크기(원본 자연 크기)라고 가정한다.
 */
export function applySelectionAdjustToCanvas(
  source: MaskImageSource,
  width: number,
  height: number,
  mask: MaskImageSource,
  plan: SelectionAdjustPlan,
  createCanvas: SelectionCanvasFactory
): (MaskCanvasLike & MaskImageSource) | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));

  if (plan.kind === "delete") {
    const out = createCanvas(w, h);
    if (!out) return null;
    out.ctx.drawImage(source, 0, 0);
    out.ctx.globalCompositeOperation = "destination-out";
    out.ctx.drawImage(mask, 0, 0);
    out.ctx.globalCompositeOperation = "source-over";
    return out.canvas;
  }

  const adjusted = createCanvas(w, h);
  if (!adjusted) return null;
  adjusted.ctx.filter = plan.cssFilter;
  adjusted.ctx.drawImage(source, 0, 0);
  adjusted.ctx.filter = "none";
  adjusted.ctx.globalCompositeOperation = "destination-in";
  adjusted.ctx.drawImage(mask, 0, 0);
  adjusted.ctx.globalCompositeOperation = "source-over";

  const out = createCanvas(w, h);
  if (!out) return null;
  out.ctx.drawImage(source, 0, 0);
  out.ctx.drawImage(adjusted.canvas, 0, 0);
  return out.canvas;
}

/** 선택 픽셀 추출 결과 — 잘라낸 캔버스와 그 원본 픽셀 기준 박스(새 레이어 배치에 쓴다). */
export type SelectionExtractResult = {
  canvas: MaskCanvasLike & MaskImageSource;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
};

/**
 * 선택 영역 픽셀만 남겨 경계 박스로 잘라낸다("새 레이어로 복사/오려내기"의 추출 절반).
 * 절차: (a) 원본을 그린 뒤 destination-in 으로 마스크 안만 남기고 (b) 경계 박스 크기의 캔버스에
 * 음수 오프셋으로 옮겨 그려 크롭한다 — 페더의 부분 알파가 그대로 보존된다.
 * boundsNorm 은 selectionBoundsNorm 의 0..1 박스이며, 픽셀로 환산 후 캔버스 안으로 클램프한다.
 * 면적이 1px 미만이 되면 null(추출할 것이 없음). source/mask 는 같은 픽셀 크기라고 가정한다.
 */
export function extractSelectionToCanvas(
  source: MaskImageSource,
  width: number,
  height: number,
  mask: MaskImageSource,
  boundsNorm: { x: number; y: number; w: number; h: number },
  createCanvas: SelectionCanvasFactory
): SelectionExtractResult | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (
    !Number.isFinite(boundsNorm.x) || !Number.isFinite(boundsNorm.y)
    || !Number.isFinite(boundsNorm.w) || !Number.isFinite(boundsNorm.h)
  ) {
    return null;
  }
  const left = Math.max(0, Math.min(w, Math.floor(boundsNorm.x * w)));
  const top = Math.max(0, Math.min(h, Math.floor(boundsNorm.y * h)));
  const right = Math.max(left, Math.min(w, Math.ceil((boundsNorm.x + boundsNorm.w) * w)));
  const bottom = Math.max(top, Math.min(h, Math.ceil((boundsNorm.y + boundsNorm.h) * h)));
  const cropWidth = right - left;
  const cropHeight = bottom - top;
  if (cropWidth < 1 || cropHeight < 1) return null;

  const masked = createCanvas(w, h);
  if (!masked) return null;
  masked.ctx.drawImage(source, 0, 0);
  masked.ctx.globalCompositeOperation = "destination-in";
  masked.ctx.drawImage(mask, 0, 0);
  masked.ctx.globalCompositeOperation = "source-over";

  const out = createCanvas(cropWidth, cropHeight);
  if (!out) return null;
  out.ctx.drawImage(masked.canvas, -left, -top);
  return { canvas: out.canvas, cropX: left, cropY: top, cropWidth, cropHeight };
}
