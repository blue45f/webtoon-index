/**
 * Studio Path Boolean — 벡터 패스 불리언(도형 결합: 합치기/빼기/교차/제외)의
 * 문서 어댑터와 결정적 호환 엔진.
 *
 * 제품의 우선 계산 경로는 전용 Worker에서 실행되는 CanvasKit PathOps다. 이 모듈은
 * DrawEl을 정확한 cubic SVG 입력으로 직렬화하고 CanvasKit의 portable contour 영수증을
 * 현재 points 기반 문서 경계로 투영한다. Worker/WASM을 시작할 수 없는 환경에서는
 * polygon-clipping(Martinez-Rueda) 기반 호환 경로도 제공한다.
 *
 * 호환 파이프라인:
 *   1) studioShapeToPolygon — DrawEl 도형(rect/ellipse/star/triangle/polygon/freehand)을
 *      페이지 좌표 폴리곤 링으로 전개. 곡선(타원·둥근 모서리)은 세그먼트 근사(≥64),
 *      회전은 bbox 중심 기준으로 적용. 렌더 파이프라인(StudioDrawNode/studio-svg-export)과
 *      동일한 지오메트리 헬퍼(starPathPoints/polygonPathPointsInBounds/effectiveCornerRadius)를
 *      공유해 화면에 보이는 모양과 결합 입력이 일치한다.
 *   2) combineStudioShapePolygons — polygon-clipping 으로 union/difference/intersection/xor.
 *      라이브러리는 이 모듈 안에서도 dynamic import 로만 로드된다(첫 결합 때 별도 lazy 청크).
 *   3) studioPathBooleanOutputFromPolygons — MultiPolygon 결과를 DrawEl(kind="freehand",
 *      fill+sampleSpacing) 이 그대로 그릴 수 있는 평탄 points 링으로 변환. 구멍(hole)은
 *      바깥 링에 폭 0 브리지로 잇는 키홀(keyhole) 처리 — nonzero/evenodd 어느 채움 규칙에서도
 *      구멍이 뚫린 채 렌더된다. 결과가 비면 { ok:false, reason } (op 별 한국어 사유).
 *
 * 결과 표현 계약(왜 freehand 인가): DrawEl 은 x/y/rotation 없이 points 가 곧 페이지 좌표다.
 * kind="freehand" + fill + sampleSpacing 은 StudioDrawNode 의 평면 <Line closed> 브랜치로
 * 떨어져 points 를 스무딩 없이(tension 0) 그대로 그린다 — 불리언 결과를 왜곡 없이 보존하는
 * 유일한 기존 표현이다(라쏘 필과 동일 경로). 새 요소 타입 추가 불필요.
 *
 * 순수·결정적 — DOM/Konva/난수/시간 의존 없음. 입력 배열은 절대 변형하지 않는다.
 */

import {
  effectiveCornerRadius,
  normalizeShapeParams,
  polygonPathPointsInBounds,
  starPathPoints,
} from "./brush/studio-stroke-shapes";

import type { StudioPortablePathGeometryContour } from "./render/studio-canvaskit-adapter";
import type { DrawEl, El } from "./studio-element-model";

// ---------------------------------------------------------------------------
// 카탈로그
// ---------------------------------------------------------------------------

export type StudioPathBooleanOp = "union" | "subtract" | "intersect" | "exclude";

/** 패널 칩 목록 — id/라벨/설명(EXTENDED_BLEND_MODES 와 동일 관례). */
export const STUDIO_PATH_BOOLEAN_OPS: {
  id: StudioPathBooleanOp;
  label: string;
  tip: string;
}[] = [
  {
    id: "union",
    label: "합치기",
    tip: "두 도형을 하나의 외곽선으로 합칩니다(Illustrator 합치기).",
  },
  {
    id: "subtract",
    label: "빼기",
    tip: "아래 도형에서 위 도형이 겹친 부분을 오려냅니다(앞면 오브젝트 빼기).",
  },
  {
    id: "intersect",
    label: "교차",
    tip: "두 도형이 겹치는 부분만 남깁니다.",
  },
  {
    id: "exclude",
    label: "제외",
    tip: "겹치는 부분만 뚫어내고 나머지를 남깁니다(XOR).",
  },
];

export function isStudioPathBooleanOp(value: string): value is StudioPathBooleanOp {
  return STUDIO_PATH_BOOLEAN_OPS.some((op) => op.id === value);
}

/** 히스토리 라벨·상태 문구용 한글 라벨 조회(모르는 id 는 그대로 반환). */
export function studioPathBooleanOpLabel(id: string): string {
  return STUDIO_PATH_BOOLEAN_OPS.find((op) => op.id === id)?.label ?? id;
}

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 닫힌 링 — [x,y] 좌표쌍 목록. 마지막 정점은 첫 정점을 반복하지 않는다(엔진 정규형). */
export type StudioPathRing = [number, number][];
/** 폴리곤 — [외곽 링, ...구멍 링]. polygon-clipping 의 Polygon 과 구조 동일. */
export type StudioPathPolygon = StudioPathRing[];

/** 결합 가능한 도형 종류 — 면이 없는 line/arrow 는 제외. */
export type StudioPathBooleanShapeKind =
  | "rect"
  | "ellipse"
  | "star"
  | "triangle"
  | "polygon"
  | "freehand";

/**
 * 도형 지오메트리 스펙 — DrawEl 저장 형태 그대로.
 *  - rect/ellipse/star/triangle/polygon: points = 드래그 시작/끝 두 모서리 [x1,y1,x2,y2]
 *    (StudioDrawNode 의 drawBounds 규약), shapeParams 로 별/다각형/모서리 반경 결정.
 *  - freehand: points 가 곧 닫힌 폐곡선 링(라쏘 필·이전 불리언 결과 재결합용).
 *  - rotationDeg: bbox 중심 기준 회전(도). DrawEl 은 회전 필드가 없어 보통 0.
 */
export interface StudioPathBooleanShapeSpec {
  kind: StudioPathBooleanShapeKind;
  points: readonly number[];
  /** DrawEl.shapeParams 원본 — normalizeShapeParams 로 안전 정규화된다. */
  shapeParams?: unknown;
  rotationDeg?: number;
}

export interface StudioShapeToPolygonOptions {
  /** 곡선(타원/둥근 모서리) 세그먼트 수. 64 미만은 64 로, 512 초과는 512 로 클램프. */
  curveSegments?: number;
}

export type StudioShapeToPolygonResult =
  | { ok: true; polygon: StudioPathPolygon }
  | { ok: false; reason: string };

export interface StudioPathBooleanBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 결과 조각 1개 — points 는 첫 정점을 끝에 반복한 "명시적으로 닫힌" 평탄 링. */
export interface StudioPathBooleanPiece {
  points: number[];
  holeCount: number;
  bounds: StudioPathBooleanBounds;
}

export interface StudioPathBooleanOutput {
  pieces: StudioPathBooleanPiece[];
  bounds: StudioPathBooleanBounds;
}

export type StudioPathBooleanCombineResult =
  | { ok: true; output: StudioPathBooleanOutput }
  | { ok: false; reason: string };

export const STUDIO_PATH_BOOLEAN_MIN_CURVE_SEGMENTS = 64;
export const STUDIO_PATH_BOOLEAN_MAX_CURVE_SEGMENTS = 512;

/** 이 넓이(px²) 미만 링은 수치 잔부스러기로 보고 버린다. */
const MIN_RING_AREA = 0.01;
/** bbox 한 변이 이보다 짧으면 면적 없는 도형으로 거부. */
const MIN_SPAN = 0.01;

/**
 * 결과 DrawEl 의 sampleSpacing — 어떤 유한값이든 StudioDrawNode 가 스무딩 없는
 * (tension 0, points 그대로) 브랜치를 타게 만든다. 3 은 legacy 렌더 간격과 동일한 관례값.
 */
export const STUDIO_PATH_BOOLEAN_RESULT_SAMPLE_SPACING = 3;

// ---------------------------------------------------------------------------
// 수치 유틸
// ---------------------------------------------------------------------------

/** 소수 둘째 자리 반올림 — 지오메트리 출력을 결정적·직렬화 친화적으로 유지. */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 평탄 [x0,y0,...] 링의 부호 있는 넓이(신발끈 공식 ÷2). 끝에 반복된 닫힘 정점은 0 기여. */
export function studioPathSignedArea(flat: readonly number[]): number {
  const n = Math.floor(flat.length / 2);
  if (n < 3) return 0;
  let doubled = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    doubled += flat[i * 2]! * flat[j * 2 + 1]! - flat[j * 2]! * flat[i * 2 + 1]!;
  }
  return doubled / 2;
}

function ringSignedArea(ring: StudioPathRing): number {
  let doubled = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[(i + 1) % ring.length]!;
    doubled += ax * by - bx * ay;
  }
  return doubled / 2;
}

/** 연속 중복 정점 제거 + 첫 정점과 같은 꼬리 정점 제거(엔진 정규형). */
function dedupeRing(ring: StudioPathRing): StudioPathRing {
  const out: StudioPathRing = [];
  for (const point of ring) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === point[0] && prev[1] === point[1]) continue;
    out.push(point);
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (first[0] === last[0] && first[1] === last[1]) out.pop();
    else break;
  }
  return out;
}

function roundRing(ring: StudioPathRing): StudioPathRing {
  return ring.map(([x, y]) => [round2(x), round2(y)] as [number, number]);
}

function ringBounds(rings: readonly StudioPathRing[]): StudioPathBooleanBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: round2(minX),
    y: round2(minY),
    width: round2(maxX - minX),
    height: round2(maxY - minY),
  };
}

function rotateRing(ring: StudioPathRing, cx: number, cy: number, deg: number): StudioPathRing {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return ring.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos] as [number, number];
  });
}

function flatToRing(flat: readonly number[]): StudioPathRing {
  const ring: StudioPathRing = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    ring.push([flat[i]!, flat[i + 1]!]);
  }
  return ring;
}

// ---------------------------------------------------------------------------
// 1) 도형 → 폴리곤 링
// ---------------------------------------------------------------------------

function clampCurveSegments(raw: number | undefined): number {
  if (!isFiniteNumber(raw)) return STUDIO_PATH_BOOLEAN_MIN_CURVE_SEGMENTS;
  return Math.min(
    STUDIO_PATH_BOOLEAN_MAX_CURVE_SEGMENTS,
    Math.max(STUDIO_PATH_BOOLEAN_MIN_CURVE_SEGMENTS, Math.round(raw))
  );
}

function ellipseRing(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  segments: number
): StudioPathRing {
  const ring: StudioPathRing = [];
  for (let i = 0; i < segments; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / segments;
    ring.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return ring;
}

function roundedRectRing(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  curveSegments: number
): StudioPathRing {
  if (radius <= 0) {
    return [
      [x, y],
      [x + width, y],
      [x + width, y + height],
      [x, y + height],
    ];
  }
  const cornerSegments = Math.max(2, Math.round(curveSegments / 4));
  const ring: StudioPathRing = [];
  const corner = (cx: number, cy: number, fromAngle: number): void => {
    for (let i = 0; i <= cornerSegments; i++) {
      const angle = fromAngle + ((Math.PI / 2) * i) / cornerSegments;
      ring.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
    }
  };
  // 시계 방향(화면 좌표 y-아래): 좌상 → 우상 → 우하 → 좌하 코너.
  corner(x + radius, y + radius, Math.PI);
  corner(x + width - radius, y + radius, -Math.PI / 2);
  corner(x + width - radius, y + height - radius, 0);
  corner(x + radius, y + height - radius, Math.PI / 2);
  return ring;
}

/**
 * 도형 스펙 → 폴리곤([외곽 링]). 렌더와 동일한 배치 규칙:
 * rect=bbox+모서리 반경, ellipse=bbox 내접, star=중심+min(w,h)/2 외접(Konva Star),
 * triangle/polygon=bbox 정합(polygonPathPointsInBounds), freehand=points 자체가 링.
 */
export function studioShapeToPolygon(
  spec: StudioPathBooleanShapeSpec,
  options: StudioShapeToPolygonOptions = {}
): StudioShapeToPolygonResult {
  const flat = spec.points;
  if (!Array.isArray(flat) || flat.length % 2 !== 0 || !flat.every(isFiniteNumber)) {
    return { ok: false, reason: "도형 좌표가 손상되어 결합할 수 없어요." };
  }
  const curveSegments = clampCurveSegments(options.curveSegments);
  const rotationDeg = isFiniteNumber(spec.rotationDeg) ? spec.rotationDeg : 0;

  let ring: StudioPathRing;
  if (spec.kind === "freehand") {
    ring = dedupeRing(roundRing(flatToRing(flat)));
    if (ring.length < 3) {
      return { ok: false, reason: "점이 3개 이상인 닫힌 획만 결합할 수 있어요." };
    }
  } else {
    if (flat.length < 4) {
      return { ok: false, reason: "도형 좌표가 손상되어 결합할 수 없어요." };
    }
    const [x1, y1, x2, y2] = [flat[0]!, flat[1]!, flat[2]!, flat[3]!];
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    if (width < MIN_SPAN || height < MIN_SPAN) {
      return { ok: false, reason: "면적이 없는(납작한) 도형은 결합할 수 없어요." };
    }
    const params = normalizeShapeParams(spec.shapeParams);
    if (spec.kind === "rect") {
      const radius = effectiveCornerRadius(width, height, params.cornerRadius);
      ring = roundedRectRing(x, y, width, height, radius, curveSegments);
    } else if (spec.kind === "ellipse") {
      ring = ellipseRing(x + width / 2, y + height / 2, width / 2, height / 2, curveSegments);
    } else if (spec.kind === "star") {
      ring = flatToRing(
        starPathPoints(x + width / 2, y + height / 2, Math.min(width, height) / 2, params)
      );
    } else {
      const sides = spec.kind === "triangle" ? 3 : params.polygonSides;
      ring = flatToRing(polygonPathPointsInBounds(x, y, width, height, sides));
    }
  }

  if (rotationDeg % 360 !== 0) {
    const bounds = ringBounds([ring]);
    ring = rotateRing(ring, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, rotationDeg);
  }
  ring = dedupeRing(roundRing(ring));
  if (ring.length < 3 || Math.abs(ringSignedArea(ring)) < MIN_RING_AREA) {
    return { ok: false, reason: "면적이 없는(납작한) 도형은 결합할 수 없어요." };
  }
  return { ok: true, polygon: [ring] };
}

// ---------------------------------------------------------------------------
// 고품질 Worker 입력/출력 어댑터
// ---------------------------------------------------------------------------

type StudioSvgPathCommand =
  | { readonly op: "M" | "L"; readonly x: number; readonly y: number }
  | {
      readonly op: "C";
      readonly c1x: number;
      readonly c1y: number;
      readonly c2x: number;
      readonly c2y: number;
      readonly x: number;
      readonly y: number;
    }
  | { readonly op: "Z" };

export type StudioPathBooleanSvgInputResult =
  | Readonly<{ ok: true; pathData: string }>
  | Readonly<{ ok: false; reason: string }>;

const CIRCLE_CUBIC_KAPPA = 0.552_284_749_830_793_6;

function pathNumber(value: number): string {
  const rounded = Math.round(value * 1_000) / 1_000;
  if (Object.is(rounded, -0)) return "0";
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(3).replace(/(?:\.0+|(\.\d+?)0+)$/u, "$1");
}

function rotatePathPoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  cos: number,
  sin: number,
): [number, number] {
  const dx = x - cx;
  const dy = y - cy;
  return [
    cx + dx * cos - dy * sin,
    cy + dx * sin + dy * cos,
  ];
}

function rotateSvgPathCommands(
  commands: readonly StudioSvgPathCommand[],
  cx: number,
  cy: number,
  rotationDeg: number,
): StudioSvgPathCommand[] {
  if (rotationDeg % 360 === 0) return [...commands];
  const radians = rotationDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return commands.map((command) => {
    if (command.op === "Z") return command;
    const [x, y] = rotatePathPoint(
      command.x,
      command.y,
      cx,
      cy,
      cos,
      sin,
    );
    if (command.op !== "C") return { op: command.op, x, y };
    const [c1x, c1y] = rotatePathPoint(
      command.c1x,
      command.c1y,
      cx,
      cy,
      cos,
      sin,
    );
    const [c2x, c2y] = rotatePathPoint(
      command.c2x,
      command.c2y,
      cx,
      cy,
      cos,
      sin,
    );
    return { op: "C", c1x, c1y, c2x, c2y, x, y };
  });
}

function svgPathData(commands: readonly StudioSvgPathCommand[]): string {
  return commands.map((command) => {
    if (command.op === "Z") return "Z";
    if (command.op === "C") {
      return [
        "C",
        pathNumber(command.c1x),
        pathNumber(command.c1y),
        pathNumber(command.c2x),
        pathNumber(command.c2y),
        pathNumber(command.x),
        pathNumber(command.y),
      ].join(" ");
    }
    return `${command.op} ${pathNumber(command.x)} ${pathNumber(command.y)}`;
  }).join(" ");
}

function ringPathCommands(ring: StudioPathRing): StudioSvgPathCommand[] {
  return ring.length === 0
    ? []
    : [
        { op: "M", x: ring[0]![0], y: ring[0]![1] },
        ...ring.slice(1).map(
          ([x, y]): StudioSvgPathCommand => ({ op: "L", x, y }),
        ),
        { op: "Z" },
      ];
}

/**
 * Converts a current Studio shape into canonical SVG path input for CanvasKit PathOps.
 * Ellipses and rounded rectangles remain cubic curves instead of the polygon fallback's
 * 64–512 straight segments.
 */
export function studioPathBooleanShapeToSvgPathData(
  spec: StudioPathBooleanShapeSpec,
): StudioPathBooleanSvgInputResult {
  const admitted = studioShapeToPolygon(spec);
  if (!admitted.ok) return admitted;

  const rotationDeg = isFiniteNumber(spec.rotationDeg) ? spec.rotationDeg : 0;
  if (spec.kind === "freehand") {
    const ring = admitted.polygon[0]!;
    return {
      ok: true,
      pathData: svgPathData(ringPathCommands(ring)),
    };
  }

  const [x1, y1, x2, y2] = [
    spec.points[0]!,
    spec.points[1]!,
    spec.points[2]!,
    spec.points[3]!,
  ];
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const params = normalizeShapeParams(spec.shapeParams);
  let commands: StudioSvgPathCommand[];

  if (spec.kind === "ellipse") {
    const rx = width / 2;
    const ry = height / 2;
    const kx = rx * CIRCLE_CUBIC_KAPPA;
    const ky = ry * CIRCLE_CUBIC_KAPPA;
    commands = [
      { op: "M", x: cx, y },
      {
        op: "C",
        c1x: cx + kx,
        c1y: y,
        c2x: x + width,
        c2y: cy - ky,
        x: x + width,
        y: cy,
      },
      {
        op: "C",
        c1x: x + width,
        c1y: cy + ky,
        c2x: cx + kx,
        c2y: y + height,
        x: cx,
        y: y + height,
      },
      {
        op: "C",
        c1x: cx - kx,
        c1y: y + height,
        c2x: x,
        c2y: cy + ky,
        x,
        y: cy,
      },
      {
        op: "C",
        c1x: x,
        c1y: cy - ky,
        c2x: cx - kx,
        c2y: y,
        x: cx,
        y,
      },
      { op: "Z" },
    ];
  } else if (spec.kind === "rect") {
    const radius = effectiveCornerRadius(
      width,
      height,
      params.cornerRadius,
    );
    if (radius <= 0) {
      commands = ringPathCommands([
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
      ]);
    } else {
      const k = radius * CIRCLE_CUBIC_KAPPA;
      commands = [
        { op: "M", x: x + radius, y },
        { op: "L", x: x + width - radius, y },
        {
          op: "C",
          c1x: x + width - radius + k,
          c1y: y,
          c2x: x + width,
          c2y: y + radius - k,
          x: x + width,
          y: y + radius,
        },
        { op: "L", x: x + width, y: y + height - radius },
        {
          op: "C",
          c1x: x + width,
          c1y: y + height - radius + k,
          c2x: x + width - radius + k,
          c2y: y + height,
          x: x + width - radius,
          y: y + height,
        },
        { op: "L", x: x + radius, y: y + height },
        {
          op: "C",
          c1x: x + radius - k,
          c1y: y + height,
          c2x: x,
          c2y: y + height - radius + k,
          x,
          y: y + height - radius,
        },
        { op: "L", x, y: y + radius },
        {
          op: "C",
          c1x: x,
          c1y: y + radius - k,
          c2x: x + radius - k,
          c2y: y,
          x: x + radius,
          y,
        },
        { op: "Z" },
      ];
    }
  } else {
    // Star/triangle/polygon are already exact straight-edge shapes.
    commands = ringPathCommands(admitted.polygon[0]!);
    return {
      ok: true,
      pathData: svgPathData(commands),
    };
  }

  commands = rotateSvgPathCommands(commands, cx, cy, rotationDeg);
  return { ok: true, pathData: svgPathData(commands) };
}

function pointInRing(point: [number, number], ring: StudioPathRing): boolean {
  let inside = false;
  const [x, y] = point;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index]!;
    const [xj, yj] = ring[previous]!;
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function containmentProbe(ring: StudioPathRing): [number, number] {
  const first = ring[0]!;
  const center = ring.reduce(
    (sum, point) => [sum[0] + point[0], sum[1] + point[1]] as [number, number],
    [0, 0] as [number, number],
  );
  center[0] /= ring.length;
  center[1] /= ring.length;
  return [
    first[0] + (center[0] - first[0]) * 0.000_001,
    first[1] + (center[1] - first[1]) * 0.000_001,
  ];
}

/**
 * Rebuilds outer/hole hierarchy from CanvasKit's winding-normalized portable contours, then
 * adapts it to the existing points-based document representation.
 */
export function studioPathBooleanOutputFromPortableContours(
  contours: readonly StudioPortablePathGeometryContour[],
  op: StudioPathBooleanOp,
): StudioPathBooleanCombineResult {
  const rings = contours
    .filter((contour) => contour.closed)
    .map((contour) => dedupeRing(roundRing(flatToRing(contour.points))))
    .filter(
      (ring) => ring.length >= 3
        && Math.abs(ringSignedArea(ring)) >= MIN_RING_AREA,
    )
    .map((ring, inputIndex) => ({
      ring,
      inputIndex,
      area: Math.abs(ringSignedArea(ring)),
      parent: -1,
      depth: 0,
    }))
    .sort((left, right) => (
      right.area - left.area || left.inputIndex - right.inputIndex
    ));

  for (let index = 0; index < rings.length; index += 1) {
    const child = rings[index]!;
    const probe = containmentProbe(child.ring);
    let parent = -1;
    let parentArea = Infinity;
    for (let candidateIndex = 0; candidateIndex < index; candidateIndex += 1) {
      const candidate = rings[candidateIndex]!;
      if (
        candidate.area < parentArea
        && pointInRing(probe, candidate.ring)
      ) {
        parent = candidateIndex;
        parentArea = candidate.area;
      }
    }
    child.parent = parent;
    child.depth = parent < 0 ? 0 : rings[parent]!.depth + 1;
  }

  const polygons: StudioPathPolygon[] = [];
  const polygonByRing = new Map<number, StudioPathPolygon>();
  for (let index = 0; index < rings.length; index += 1) {
    const entry = rings[index]!;
    if (entry.depth % 2 === 0) {
      const polygon: StudioPathPolygon = [entry.ring];
      polygons.push(polygon);
      polygonByRing.set(index, polygon);
      continue;
    }
    let ancestor = entry.parent;
    while (ancestor >= 0 && rings[ancestor]!.depth % 2 !== 0) {
      ancestor = rings[ancestor]!.parent;
    }
    polygonByRing.get(ancestor)?.push(entry.ring);
  }
  return studioPathBooleanOutputFromPolygons(polygons, op);
}

// ---------------------------------------------------------------------------
// 2) 불리언 연산 — polygon-clipping lazy 로드
// ---------------------------------------------------------------------------

type PolygonClippingGeom = StudioPathPolygon | StudioPathPolygon[];
interface PolygonClippingLib {
  union(geom: PolygonClippingGeom, ...geoms: PolygonClippingGeom[]): StudioPathPolygon[];
  intersection(geom: PolygonClippingGeom, ...geoms: PolygonClippingGeom[]): StudioPathPolygon[];
  xor(geom: PolygonClippingGeom, ...geoms: PolygonClippingGeom[]): StudioPathPolygon[];
  difference(subject: PolygonClippingGeom, ...clips: PolygonClippingGeom[]): StudioPathPolygon[];
}

let polygonClippingPromise: Promise<PolygonClippingLib> | null = null;

/**
 * polygon-clipping 은 ESM 빌드가 default 단일 객체만 내보낸다(타입 선언은 named export —
 * 알려진 패키징 불일치). default 우선 + 네임스페이스 폴백으로 Vite/Vitest 양쪽을 흡수한다.
 */
async function loadPolygonClipping(): Promise<PolygonClippingLib> {
  polygonClippingPromise ??= import("polygon-clipping").then((mod) => {
    const candidate = (mod as { default?: unknown }).default ?? mod;
    return candidate as PolygonClippingLib;
  });
  return polygonClippingPromise;
}

/** MultiPolygon 결과를 엔진 정규형으로: 반올림·중복 제거·잔부스러기 링 필터. */
function normalizeMultiPolygon(raw: StudioPathPolygon[]): StudioPathPolygon[] {
  const polygons: StudioPathPolygon[] = [];
  for (const rawPolygon of raw) {
    const rings: StudioPathRing[] = [];
    for (const rawRing of rawPolygon) {
      const ring = dedupeRing(roundRing(rawRing));
      if (ring.length < 3 || Math.abs(ringSignedArea(ring)) < MIN_RING_AREA) continue;
      rings.push(ring);
    }
    // 외곽 링이 잔부스러기로 사라졌으면 폴리곤 전체를 버린다(구멍만 남을 수 없음).
    if (rings.length === 0 || rawPolygon.length === 0) continue;
    const outer = dedupeRing(roundRing(rawPolygon[0]!));
    if (outer.length < 3 || Math.abs(ringSignedArea(outer)) < MIN_RING_AREA) continue;
    polygons.push(rings);
  }
  return polygons;
}

/**
 * 폴리곤 여러 개를 한 번에 union 한 MultiPolygon(정규형) — 말풍선 병합(studio-bubble-merge)용.
 * polygon-clipping 은 variadic geom 을 지원하므로 한 호출로 전체 합집합을 구한다
 * (연쇄 pairwise 는 "떨어진 두 조각을 세 번째가 잇는" 케이스 처리가 번거롭다).
 */
export async function unionStudioPolygons(
  polygons: readonly StudioPathPolygon[]
): Promise<StudioPathPolygon[]> {
  if (polygons.length === 0) return [];
  const lib = await loadPolygonClipping();
  const [first, ...rest] = polygons;
  return normalizeMultiPolygon(lib.union(first!, ...rest));
}

/**
 * 폴리곤 2개를 불리언 결합한 MultiPolygon(정규형). subtract 는 a(아래) − b(위).
 * 라이브러리 예외는 호출부(combineStudioShapes)가 사유 문자열로 감싼다.
 */
export async function combineStudioShapePolygons(
  a: StudioPathPolygon,
  b: StudioPathPolygon,
  op: StudioPathBooleanOp
): Promise<StudioPathPolygon[]> {
  const lib = await loadPolygonClipping();
  const raw =
    op === "union"
      ? lib.union(a, b)
      : op === "subtract"
        ? lib.difference(a, b)
        : op === "intersect"
          ? lib.intersection(a, b)
          : lib.xor(a, b);
  return normalizeMultiPolygon(raw);
}

// ---------------------------------------------------------------------------
// 3) 결과 → DrawEl 표현
// ---------------------------------------------------------------------------

/**
 * 구멍 링을 외곽 링에 폭 0 브리지로 잇는 키홀 처리. 구멍은 외곽과 반대 방향으로 순회해
 * nonzero 채움 규칙에서도 뚫린 채 그려진다. 앵커 선택은 결정적(구멍의 최대 x → 최소 y,
 * 외곽에서는 가장 가까운 정점 → 최소 인덱스).
 */
function keyholePolygon(polygon: StudioPathPolygon): StudioPathRing {
  let ring = [...polygon[0]!];
  const outerSign = Math.sign(ringSignedArea(ring)) || 1;
  for (const rawHole of polygon.slice(1)) {
    let hole = [...rawHole];
    if (Math.sign(ringSignedArea(hole)) === outerSign) hole = hole.slice().reverse();
    let holeAnchor = 0;
    for (let i = 1; i < hole.length; i++) {
      const [hx, hy] = hole[i]!;
      const [bx, by] = hole[holeAnchor]!;
      if (hx > bx || (hx === bx && hy < by)) holeAnchor = i;
    }
    let ringAnchor = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const dx = ring[i]![0] - hole[holeAnchor]![0];
      const dy = ring[i]![1] - hole[holeAnchor]![1];
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        ringAnchor = i;
      }
    }
    const holeCycle: StudioPathRing = [];
    for (let step = 0; step <= hole.length; step++) {
      holeCycle.push(hole[(holeAnchor + step) % hole.length]!);
    }
    ring = [...ring.slice(0, ringAnchor + 1), ...holeCycle, ring[ringAnchor]!, ...ring.slice(ringAnchor + 1)];
  }
  return ring;
}

const EMPTY_RESULT_REASONS: Record<StudioPathBooleanOp, string> = {
  union: "결합 결과가 비어 있어요.",
  subtract: "위 도형이 아래 도형을 완전히 덮어 남는 면이 없어요.",
  intersect: "두 도형이 겹치지 않아 교차 영역이 없어요.",
  exclude: "두 도형이 완전히 겹쳐 남는 면이 없어요.",
};

/** 정규형 MultiPolygon → 조각(키홀 평탄 링)+bbox. 비면 op 별 사유로 실패. */
export function studioPathBooleanOutputFromPolygons(
  polygons: StudioPathPolygon[],
  op: StudioPathBooleanOp
): StudioPathBooleanCombineResult {
  const pieces: StudioPathBooleanPiece[] = [];
  const allRings: StudioPathRing[] = [];
  for (const polygon of polygons) {
    if (polygon.length === 0) continue;
    const keyholed = keyholePolygon(polygon);
    if (keyholed.length < 3) continue;
    const flat: number[] = [];
    for (const [x, y] of keyholed) flat.push(x, y);
    // 첫 정점을 끝에 반복 — fill 없는(선만 있는) 렌더에서도 외곽선이 닫혀 보이게.
    flat.push(keyholed[0]![0], keyholed[0]![1]);
    pieces.push({
      points: flat,
      holeCount: polygon.length - 1,
      bounds: ringBounds(polygon),
    });
    allRings.push(...polygon);
  }
  if (pieces.length === 0) {
    return { ok: false, reason: EMPTY_RESULT_REASONS[op] };
  }
  return { ok: true, output: { pieces, bounds: ringBounds(allRings) } };
}

/**
 * 전체 파이프라인 — 스펙 2개를 결합해 조각 목록으로. a=아래(base), b=위(top).
 * 실패는 전부 { ok:false, reason }(한국어)으로 수렴하며 예외를 던지지 않는다.
 */
export async function combineStudioShapes(
  a: StudioPathBooleanShapeSpec,
  b: StudioPathBooleanShapeSpec,
  op: StudioPathBooleanOp,
  options: StudioShapeToPolygonOptions = {}
): Promise<StudioPathBooleanCombineResult> {
  const polygonA = studioShapeToPolygon(a, options);
  if (!polygonA.ok) return { ok: false, reason: `아래 도형: ${polygonA.reason}` };
  const polygonB = studioShapeToPolygon(b, options);
  if (!polygonB.ok) return { ok: false, reason: `위 도형: ${polygonB.reason}` };
  let combined: StudioPathPolygon[];
  try {
    combined = await combineStudioShapePolygons(polygonA.polygon, polygonB.polygon, op);
  } catch {
    return { ok: false, reason: "경로 연산이 이 도형을 처리하지 못했어요(좌표를 조금 바꿔 다시 시도해 주세요)." };
  }
  return studioPathBooleanOutputFromPolygons(combined, op);
}

// ---------------------------------------------------------------------------
// DrawEl 연동 헬퍼(선택 게이트 · 결과 시드)
// ---------------------------------------------------------------------------

/**
 * DrawEl → 결합 스펙. 결합 불가(지우개/선·화살표/대칭 적용)는 null.
 * kind 미설정 legacy 획은 freehand 로 취급한다.
 */
export function drawElToStudioPathBooleanSpec(el: DrawEl): StudioPathBooleanShapeSpec | null {
  if (el.mode === "eraser") return null;
  if (el.symmetry && el.symmetry.type !== "none") return null;
  const kind = el.kind ?? "freehand";
  if (kind === "line" || kind === "arrow") return null;
  return { kind, points: el.points, shapeParams: el.shapeParams };
}

/**
 * 선택이 "결합 가능한 도형 정확히 2개"인지 검사 — 아니면 패널에 보여줄 한국어 사유.
 * 잠금/숨김 같은 페이지 상태 게이트는 호출부(StudioPage)가 추가로 검사한다.
 */
export function studioPathBooleanUnavailableReason(selection: readonly El[]): string | null {
  if (selection.length !== 2) {
    return "캔버스에서 도형 2개를 함께 선택하세요(드래그 선택).";
  }
  for (const el of selection) {
    if (el.type !== "draw") {
      return "그리기 도형끼리만 결합할 수 있어요(이미지·글자·말풍선 제외).";
    }
    if (el.mode === "eraser") {
      return "지우개 획은 결합할 수 없어요.";
    }
    if (el.symmetry && el.symmetry.type !== "none") {
      return "대칭이 적용된 도형은 대칭을 해제한 뒤 결합해 주세요.";
    }
    const kind = el.kind ?? "freehand";
    if (kind === "line" || kind === "arrow") {
      return "선·화살표는 면이 없어 결합할 수 없어요.";
    }
  }
  return null;
}

/**
 * 결과 조각 1개 → DrawEl 시드(id 제외). 스타일은 아래(base) 도형에서 계승한다.
 * 그라데이션/패턴 채우기는 freehand 렌더가 지원하지 않아 단색 fill 만 넘어간다.
 */
export function studioPathBooleanPieceToDrawElSeed(
  piece: StudioPathBooleanPiece,
  base: Pick<DrawEl, "stroke" | "strokeWidth" | "fill" | "opacity">
): Omit<DrawEl, "id"> {
  return {
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [...piece.points],
    stroke: base.stroke,
    strokeWidth: base.strokeWidth,
    ...(base.fill !== undefined ? { fill: base.fill } : {}),
    ...(base.opacity !== undefined ? { opacity: base.opacity } : {}),
    sampleSpacing: STUDIO_PATH_BOOLEAN_RESULT_SAMPLE_SPACING,
  };
}
