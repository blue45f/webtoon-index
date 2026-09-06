/**
 * Studio Stroke & Shape Parameter Engine
 * 일러스트레이터급 "선 스타일 + 도형 파라미터" 순수 엔진.
 *  - 스트로크 스타일: 점선 프리셋 6종(dash) · 선 끝 모양(lineCap) · 시작/끝 화살촉(arrowStart/End).
 *    Konva 노드 props(dash/lineCap)와 Canvas 2D ctx(setLineDash/lineCap) 양쪽에 적용할 수 있다.
 *  - 도형 파라미터: 별 꼭짓점 수/내부 반경 비율, 다각형 변 수, 사각형 모서리 반경 스키마와
 *    파라미터 → 패스 포인트(평탄 [x0,y0,x1,y1,...] 폴리곤) 생성 순수함수.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 렌더·패널 UI·단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

// ---------------------------------------------------------------------------
// 공용 수치 유틸
// ---------------------------------------------------------------------------

/** [min,max] 클램프. 숫자가 아니면 fallback. */
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/** 정수 클램프(반올림). 숫자가 아니면 fallback. */
function clampIntTo(raw: unknown, min: number, max: number, fallback: number): number {
  return Math.round(clampTo(raw, min, max, fallback));
}

/** 소수 둘째 자리 반올림 — 지오메트리 출력을 결정적·직렬화 친화적으로 유지. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** id 목록에서 raw가 유효한 id면 그대로, 아니면 fallback. */
function pickId<T extends string>(list: readonly { id: T }[], raw: unknown, fallback: T): T {
  return typeof raw === "string" && list.some((item) => item.id === raw) ? (raw as T) : fallback;
}

// ---------------------------------------------------------------------------
// 스트로크 스타일 — 점선 프리셋 · 선 끝 · 화살촉
// ---------------------------------------------------------------------------

/** 대상 도형 종류 — StudioPage의 DrawShapeKind와 구조적으로 동일한 문자열 유니언. */
export type StrokeShapeKind = "line" | "rect" | "ellipse" | "star" | "arrow" | "triangle" | "polygon";

/** 점선 프리셋 6종 id. */
export type StrokeDashKind = "solid" | "dash" | "longDash" | "dot" | "dashDot" | "sparse";
/** 선 끝 모양 — Canvas/Konva lineCap과 동일 값. */
export type StrokeLineCap = "butt" | "round" | "square";
/** 화살촉 종류 — 없음/삼각 화살촉/점(원). */
export type StrokeArrowHead = "none" | "arrow" | "dot";

/** 선/도형 공용 스트로크 스타일. 화살촉은 "line" 종류에서만 그려진다. */
export type StrokeStyle = {
  dash: StrokeDashKind;
  lineCap: StrokeLineCap;
  arrowStart: StrokeArrowHead;
  arrowEnd: StrokeArrowHead;
};

/** 기본 스트로크 스타일 — 기존 하드코딩 렌더(실선·둥근 끝·화살촉 없음)와 동일. */
export const DEFAULT_STROKE_STYLE: StrokeStyle = {
  dash: "solid",
  lineCap: "round",
  arrowStart: "none",
  arrowEnd: "none",
};

/**
 * 점선 프리셋 6종 — pattern은 선 굵기 배수 단위(굵기 1px 기준 px).
 * 실제 dash 배열은 strokeDashArray()가 선 굵기에 비례해 스케일한다(일러스트레이터 방식).
 */
export const STROKE_DASH_PRESETS: { id: StrokeDashKind; label: string; tip: string; pattern: readonly number[] }[] = [
  { id: "solid", label: "실선", tip: "끊김 없는 기본 선", pattern: [] },
  { id: "dash", label: "파선", tip: "짧은 선이 반복되는 파선", pattern: [3, 2] },
  { id: "longDash", label: "긴 파선", tip: "길게 끊어지는 파선", pattern: [6, 3] },
  { id: "dot", label: "점선", tip: "촘촘한 점 반복", pattern: [1, 2] },
  { id: "dashDot", label: "일점쇄선", tip: "파선과 점이 번갈아 나오는 쇄선", pattern: [5, 2, 1, 2] },
  { id: "sparse", label: "성긴 점선", tip: "드문드문 찍히는 점", pattern: [1, 4] },
];

/** 선 끝 모양 선택지(라벨은 패널 칩에 그대로 노출). */
export const STROKE_LINE_CAPS: { id: StrokeLineCap; label: string; tip: string }[] = [
  { id: "butt", label: "평면", tip: "끝점에서 선을 딱 자릅니다." },
  { id: "round", label: "둥근", tip: "끝을 반원으로 부드럽게 마감합니다." },
  { id: "square", label: "사각", tip: "끝을 굵기의 절반만큼 더 나간 사각으로 마감합니다." },
];

/** 화살촉 선택지 — 선("line")의 시작/끝에 각각 지정. */
export const STROKE_ARROW_HEADS: { id: StrokeArrowHead; label: string; tip: string }[] = [
  { id: "none", label: "없음", tip: "화살촉을 그리지 않습니다." },
  { id: "arrow", label: "화살촉", tip: "삼각형 화살촉을 그립니다." },
  { id: "dot", label: "점", tip: "끝점에 채운 원을 찍습니다." },
];

/**
 * 점선 프리셋 → Canvas/Konva dash 배열. 선 굵기에 비례해 스케일한다(최소 1px 단위).
 * 실선은 undefined(= dash 미적용)를 반환해 Konva 기본 동작을 유지한다.
 */
export function strokeDashArray(kind: StrokeDashKind, strokeWidth: number): number[] | undefined {
  const preset = STROKE_DASH_PRESETS.find((p) => p.id === kind) ?? STROKE_DASH_PRESETS[0]!;
  if (preset.pattern.length === 0) return undefined;
  const unit = typeof strokeWidth === "number" && Number.isFinite(strokeWidth) ? Math.max(1, strokeWidth) : 1;
  return preset.pattern.map((seg) => Math.max(0.5, Math.round(seg * unit * 10) / 10));
}

/** 저장/외부 입력을 안전한 StrokeStyle로 정규화 — 미설정·이상값은 필드별 기본값. */
export function normalizeStrokeStyle(raw: unknown): StrokeStyle {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STROKE_STYLE };
  const obj = raw as Partial<Record<keyof StrokeStyle, unknown>>;
  return {
    dash: pickId(STROKE_DASH_PRESETS, obj.dash, DEFAULT_STROKE_STYLE.dash),
    lineCap: pickId(STROKE_LINE_CAPS, obj.lineCap, DEFAULT_STROKE_STYLE.lineCap),
    arrowStart: pickId(STROKE_ARROW_HEADS, obj.arrowStart, DEFAULT_STROKE_STYLE.arrowStart),
    arrowEnd: pickId(STROKE_ARROW_HEADS, obj.arrowEnd, DEFAULT_STROKE_STYLE.arrowEnd),
  };
}

/** 기본 스트로크 스타일(실선·둥근 끝·화살촉 없음)인지 — 패널 "기본값" 버튼 비활성 판정용. */
export function isDefaultStrokeStyle(style: StrokeStyle): boolean {
  return (
    style.dash === DEFAULT_STROKE_STYLE.dash &&
    style.lineCap === DEFAULT_STROKE_STYLE.lineCap &&
    style.arrowStart === DEFAULT_STROKE_STYLE.arrowStart &&
    style.arrowEnd === DEFAULT_STROKE_STYLE.arrowEnd
  );
}

/** Konva 노드에 그대로 스프레드할 dash/lineCap props. 실선이면 dash: undefined. */
export function strokeStyleNodeProps(
  style: StrokeStyle,
  strokeWidth: number
): { dash: number[] | undefined; lineCap: StrokeLineCap } {
  return { dash: strokeDashArray(style.dash, strokeWidth), lineCap: style.lineCap };
}

/** Canvas 2D 컨텍스트 최소 인터페이스 — DOM 타입 무의존(테스트는 가짜 ctx 사용). */
export interface StrokeStyleCtxLike {
  lineCap: string;
  setLineDash(segments: number[]): void;
}

/** ctx에 스트로크 스타일 적용 — lineCap 지정 + dash 배열 세팅(실선은 빈 배열로 해제). */
export function applyStrokeStyleToCtx(ctx: StrokeStyleCtxLike, style: StrokeStyle, strokeWidth: number): void {
  ctx.lineCap = style.lineCap;
  ctx.setLineDash(strokeDashArray(style.dash, strokeWidth) ?? []);
}

// ---------------------------------------------------------------------------
// 화살촉 지오메트리 — 선("line") 시작/끝에 그릴 삼각형/점
// ---------------------------------------------------------------------------

/** 화살촉 한 개의 지오메트리 — 닫힌 삼각형(평탄 6개 좌표) 또는 채운 원. */
export type ArrowHeadGeom =
  | { kind: "arrow"; points: number[] }
  | { kind: "dot"; cx: number; cy: number; r: number };

/** 화살촉(삼각형) 길이 — 선 굵기에 비례, 최소 8px. */
export function arrowHeadSize(strokeWidth: number): number {
  return Math.max(8, strokeWidth * 2.5);
}

/** 점 화살촉 반지름 — 선 굵기에 비례, 최소 3px. */
export function arrowDotRadius(strokeWidth: number): number {
  return Math.max(3, strokeWidth * 1.2);
}

// 화살촉 날개 벌어짐 각(라디안) — 약 25.7°, 일러스트레이터 기본 화살촉 비율에 근사.
const ARROW_SPREAD = Math.PI / 7;

/**
 * 끝점 (x,y)에서 진행 방향 angleRad(라디안)를 향하는 화살촉 지오메트리.
 * head가 "none"이면 null. "arrow"는 꼭짓점이 정확히 (x,y)에 오는 닫힌 삼각형.
 */
export function arrowHeadGeometry(
  x: number,
  y: number,
  angleRad: number,
  strokeWidth: number,
  head: StrokeArrowHead
): ArrowHeadGeom | null {
  if (head === "none") return null;
  if (head === "dot") return { kind: "dot", cx: round2(x), cy: round2(y), r: round2(arrowDotRadius(strokeWidth)) };
  const size = arrowHeadSize(strokeWidth);
  return {
    kind: "arrow",
    points: [
      round2(x),
      round2(y),
      round2(x - size * Math.cos(angleRad - ARROW_SPREAD)),
      round2(y - size * Math.sin(angleRad - ARROW_SPREAD)),
      round2(x - size * Math.cos(angleRad + ARROW_SPREAD)),
      round2(y - size * Math.sin(angleRad + ARROW_SPREAD)),
    ],
  };
}

// 폴리라인에서 시작점과 처음으로 다른 점까지의 방향각. 전부 같은 점이면 null.
function firstSegmentAngle(points: number[]): number | null {
  const x0 = points[0]!;
  const y0 = points[1]!;
  for (let i = 2; i + 1 < points.length; i += 2) {
    const dx = points[i]! - x0;
    const dy = points[i + 1]! - y0;
    if (dx * dx + dy * dy > 1e-6) return Math.atan2(dy, dx);
  }
  return null;
}

// 폴리라인 끝점 직전의 유효 세그먼트 방향각(끝점을 향하는 방향). 없으면 null.
function lastSegmentAngle(points: number[]): number | null {
  const xn = points[points.length - 2]!;
  const yn = points[points.length - 1]!;
  for (let i = points.length - 4; i >= 0; i -= 2) {
    const dx = xn - points[i]!;
    const dy = yn - points[i + 1]!;
    if (dx * dx + dy * dy > 1e-6) return Math.atan2(dy, dx);
  }
  return null;
}

/**
 * 선(폴리라인 [x0,y0,...,xn,yn])의 시작/끝 화살촉 지오메트리 목록.
 * 시작 화살촉은 선 바깥(진행 반대) 방향을 향한다. 점이 부족하거나 길이가 0이면 [].
 */
/**
 * True when a `line` actually renders an arrowhead, from its stroke style.
 *
 * The head is sized `Math.max(8, strokeWidth * 2)` — an absolute floor that does not scale — so
 * the live transform preview has to know whether one exists. Claiming it for every line cost
 * plain lines a preview over geometry they never draw.
 */
export function studioLineDrawsArrowHead(style: Partial<StrokeStyle> | undefined): boolean {
  const start = style?.arrowStart ?? DEFAULT_STROKE_STYLE.arrowStart;
  const end = style?.arrowEnd ?? DEFAULT_STROKE_STYLE.arrowEnd;
  return start !== "none" || end !== "none";
}

export function lineArrowHeadGeoms(points: number[], style: StrokeStyle, strokeWidth: number): ArrowHeadGeom[] {
  if (points.length < 4 || points.length % 2 !== 0) return [];
  if (points.some((v) => typeof v !== "number" || !Number.isFinite(v))) return [];
  const startAngle = firstSegmentAngle(points);
  const endAngle = lastSegmentAngle(points);
  if (startAngle === null || endAngle === null) return [];
  const geoms: ArrowHeadGeom[] = [];
  const start = arrowHeadGeometry(points[0]!, points[1]!, startAngle + Math.PI, strokeWidth, style.arrowStart);
  if (start) geoms.push(start);
  const end = arrowHeadGeometry(
    points[points.length - 2]!,
    points[points.length - 1]!,
    endAngle,
    strokeWidth,
    style.arrowEnd
  );
  if (end) geoms.push(end);
  return geoms;
}

/** 화살촉을 채워 그릴 때 필요한 ctx 최소 인터페이스. */
export interface ArrowHeadCtxLike {
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void;
  fill(): void;
}

/** 화살촉 지오메트리 하나를 ctx에 채워 그린다(fillStyle은 호출부가 선 색으로 지정). */
export function traceArrowHeadOnCtx(ctx: ArrowHeadCtxLike, geom: ArrowHeadGeom): void {
  ctx.beginPath();
  if (geom.kind === "dot") {
    ctx.arc(geom.cx, geom.cy, geom.r, 0, Math.PI * 2);
  } else {
    ctx.moveTo(geom.points[0]!, geom.points[1]!);
    for (let i = 2; i + 1 < geom.points.length; i += 2) {
      ctx.lineTo(geom.points[i]!, geom.points[i + 1]!);
    }
    ctx.closePath();
  }
  ctx.fill();
}

// ---------------------------------------------------------------------------
// 도형 파라미터 — 별 꼭짓점/내부 비율 · 다각형 변 수 · 사각형 모서리 반경
// ---------------------------------------------------------------------------

/** 도형별 편집 가능 파라미터 스키마. */
export type ShapeParams = {
  starPoints: number; // 별 꼭짓점 수(정수)
  starInnerRatio: number; // 별 내부 반경 비율(외접 반경 대비, 작을수록 뾰족)
  polygonSides: number; // 다각형 변 수(정수)
  cornerRadius: number; // 사각형 모서리 반경(px)
};

/** 기본값 — 기존 하드코딩 렌더(별 5각·내부 1/2·육각형·모서리 3px)와 동일해 하위호환. */
export const DEFAULT_SHAPE_PARAMS: ShapeParams = {
  starPoints: 5,
  starInnerRatio: 0.5,
  polygonSides: 6,
  cornerRadius: 3,
};

/** 패널 슬라이더 범위 — normalize와 UI가 같은 값을 공유한다. */
export const SHAPE_PARAM_RANGES = {
  starPoints: { min: 3, max: 12, step: 1 },
  starInnerRatio: { min: 0.1, max: 0.9, step: 0.05 },
  polygonSides: { min: 3, max: 12, step: 1 },
  cornerRadius: { min: 0, max: 120, step: 1 },
} as const;

/** 저장/외부 입력을 안전한 ShapeParams로 정규화 — 범위 클램프 + 정수 필드 반올림. */
export function normalizeShapeParams(raw: unknown): ShapeParams {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SHAPE_PARAMS };
  const obj = raw as Partial<Record<keyof ShapeParams, unknown>>;
  const r = SHAPE_PARAM_RANGES;
  return {
    starPoints: clampIntTo(obj.starPoints, r.starPoints.min, r.starPoints.max, DEFAULT_SHAPE_PARAMS.starPoints),
    starInnerRatio: clampTo(
      obj.starInnerRatio,
      r.starInnerRatio.min,
      r.starInnerRatio.max,
      DEFAULT_SHAPE_PARAMS.starInnerRatio
    ),
    polygonSides: clampIntTo(
      obj.polygonSides,
      r.polygonSides.min,
      r.polygonSides.max,
      DEFAULT_SHAPE_PARAMS.polygonSides
    ),
    cornerRadius: clampTo(
      obj.cornerRadius,
      r.cornerRadius.min,
      r.cornerRadius.max,
      DEFAULT_SHAPE_PARAMS.cornerRadius
    ),
  };
}

/** 기본 도형 파라미터인지 — 패널 "기본값" 버튼 비활성 판정용. */
export function isDefaultShapeParams(params: ShapeParams): boolean {
  return (
    params.starPoints === DEFAULT_SHAPE_PARAMS.starPoints &&
    params.starInnerRatio === DEFAULT_SHAPE_PARAMS.starInnerRatio &&
    params.polygonSides === DEFAULT_SHAPE_PARAMS.polygonSides &&
    params.cornerRadius === DEFAULT_SHAPE_PARAMS.cornerRadius
  );
}

// ---------------------------------------------------------------------------
// 파라미터 → 패스 포인트 생성(순수)
// ---------------------------------------------------------------------------

/**
 * 별 폴리곤 포인트 — 12시 방향 꼭짓점부터 시계 방향, 외곽/내부 반경 교차.
 * 닫힌 폴리곤용 평탄 배열 [x0,y0,x1,y1,...] (꼭짓점 수 × 2개 정점 = 길이 4n).
 */
export function starPathPoints(
  cx: number,
  cy: number,
  outerRadius: number,
  params: Pick<ShapeParams, "starPoints" | "starInnerRatio">
): number[] {
  const r = SHAPE_PARAM_RANGES;
  const n = clampIntTo(params.starPoints, r.starPoints.min, r.starPoints.max, DEFAULT_SHAPE_PARAMS.starPoints);
  const ratio = clampTo(
    params.starInnerRatio,
    r.starInnerRatio.min,
    r.starInnerRatio.max,
    DEFAULT_SHAPE_PARAMS.starInnerRatio
  );
  const outer = Math.max(0.1, Number.isFinite(outerRadius) ? outerRadius : 0.1);
  const inner = outer * ratio;
  const points: number[] = [];
  for (let i = 0; i < n * 2; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / n;
    points.push(round2(cx + radius * Math.cos(angle)), round2(cy + radius * Math.sin(angle)));
  }
  return points;
}

/**
 * 정다각형 폴리곤 포인트 — 12시 방향 정점부터 시계 방향.
 * 닫힌 폴리곤용 평탄 배열(길이 2 × 변 수).
 */
export function polygonPathPoints(cx: number, cy: number, radius: number, sides: number): number[] {
  const r = SHAPE_PARAM_RANGES;
  const n = clampIntTo(sides, r.polygonSides.min, r.polygonSides.max, DEFAULT_SHAPE_PARAMS.polygonSides);
  const rad = Math.max(0.1, Number.isFinite(radius) ? radius : 0.1);
  const points: number[] = [];
  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    points.push(round2(cx + rad * Math.cos(angle)), round2(cy + rad * Math.sin(angle)));
  }
  return points;
}

/**
 * 다각형을 지정 바운딩 박스에 정확히 맞춘 패스. 홀수 변 다각형은 위 꼭짓점과 아래 변 때문에
 * 원점 기준 unit 정점의 min/max가 대칭이 아니다. 단순 radiusX/radiusY 배율은 삼각형 높이의
 * 25%를 다시 잃으므로, 먼저 unit 정점 범위를 구한 뒤 각 축을 독립적으로 bbox에 정규화한다.
 * 선 굵기는 변환하지 않는 실제 좌표를 반환해 Konva scaleX/scaleY의 비균일 stroke 왜곡도 피한다.
 */
export function polygonPathPointsInBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  sides: number
): number[] {
  const r = SHAPE_PARAM_RANGES;
  const n = clampIntTo(sides, r.polygonSides.min, r.polygonSides.max, DEFAULT_SHAPE_PARAMS.polygonSides);
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  const safeWidth = Math.max(0.1, Number.isFinite(width) ? Math.abs(width) : 0.1);
  const safeHeight = Math.max(0.1, Number.isFinite(height) ? Math.abs(height) : 0.1);
  const unit = Array.from({ length: n }, (_, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / n;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
  const minX = Math.min(...unit.map((point) => point.x));
  const maxX = Math.max(...unit.map((point) => point.x));
  const minY = Math.min(...unit.map((point) => point.y));
  const maxY = Math.max(...unit.map((point) => point.y));
  const spanX = Math.max(1e-9, maxX - minX);
  const spanY = Math.max(1e-9, maxY - minY);
  const points: number[] = [];
  for (const point of unit) {
    points.push(
      round2(left + ((point.x - minX) / spanX) * safeWidth),
      round2(top + ((point.y - minY) / spanY) * safeHeight)
    );
  }
  return points;
}

export interface PolygonPathNodeLayout {
  readonly x: number;
  readonly y: number;
  readonly points: readonly number[];
}

/**
 * Konva layout whose node origin is the bbox center while its points remain bbox-exact. Pattern
 * fills are node-local, so this keeps Canvas' tile origin identical to SVG's centered origin.
 */
export function polygonPathNodeLayoutInBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  sides: number,
): PolygonPathNodeLayout {
  const left = Number.isFinite(x) ? x : 0;
  const top = Number.isFinite(y) ? y : 0;
  const safeWidth = Math.max(0.1, Number.isFinite(width) ? Math.abs(width) : 0.1);
  const safeHeight = Math.max(0.1, Number.isFinite(height) ? Math.abs(height) : 0.1);
  return Object.freeze({
    x: left + safeWidth / 2,
    y: top + safeHeight / 2,
    points: Object.freeze(polygonPathPointsInBounds(
      -safeWidth / 2,
      -safeHeight / 2,
      safeWidth,
      safeHeight,
      sides,
    )),
  });
}

/** 사각형에 실제로 적용할 모서리 반경 — 짧은 변의 절반을 넘지 않게 클램프. */
export function effectiveCornerRadius(width: number, height: number, cornerRadius: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  const r = Number.isFinite(cornerRadius) ? Math.max(0, cornerRadius) : 0;
  const maxR = Math.max(0, Math.min(width, height) / 2);
  return Math.min(r, maxR);
}

/** 평탄 포인트 배열 → SVG <polygon points> 속성 문자열("x,y x,y ..."). 미리보기용. */
export function pathPointsToSvg(points: number[]): string {
  const pairs: string[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    pairs.push(`${points[i]},${points[i + 1]}`);
  }
  return pairs.join(" ");
}
