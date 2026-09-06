/**
 * Studio Gradient Engine — 일러스트레이터급 그라데이션 엔진.
 * 도형/텍스트 공용 멀티스톱(2~5) 그라데이션 — 선형(임의 각도, CSS 각도 규약)과
 * 방사(radial, 중심→최원거리 꼭짓점)를 하나의 직렬화 스펙으로 다룬다.
 *
 * 산출물 3종(전부 순수 함수, Konva/DOM 무의존):
 *  1. Konva fill* props — StudioPage의 react-konva 노드에 스프레드할 수 있는
 *     fillLinearGradient*·fillRadialGradient* + fillPriority 묶음.
 *  2. canvas 2D ctx 파라미터 — createLinearGradient/createRadialGradient 인자 계산
 *     (요소 로컬 bbox 입력). Konva가 내부에서 쓰는 것과 동일한 기하라서
 *     오프스크린 합성·내보내기 경로에서도 화면과 같은 결과가 나온다.
 *  3. CSS gradient 문자열 — 패널 미리보기/프리셋 스와치용. 선형 기하는 CSS
 *     linear-gradient 알고리즘을 그대로 구현해 미리보기와 캔버스가 픽셀 일치한다.
 *
 * 좌표 규약: bbox는 "그라데이션을 입힐 노드의 로컬 좌표계" 기준이다.
 *  - Rect/Text처럼 원점이 좌상단인 노드 → { x: 0, y: 0, width, height }
 *  - Ellipse/Star/RegularPolygon처럼 원점이 중심인 노드 → { x: -w/2, y: -h/2, width: w, height: h }
 * 각도 규약: CSS와 동일 — 0°=위쪽, 90°=오른쪽, 180°=아래쪽(시계방향).
 * 기존 studio-gradients(텍스트 2색 세로/가로)의 vertical=180°, horizontal=90°에 대응한다.
 */

import { isHexColor } from "./studio-gradients";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 색 단계 하나 — offset은 0..1, color는 #rrggbb(소문자 정규화). */
export type GradientStop = { offset: number; color: string };

/** 그라데이션 종류 — 선형(각도) 또는 방사(중심에서 퍼짐). */
export type GradientType = "linear" | "radial";

/**
 * 직렬화 그라데이션 스펙 — 요소(El)에 그대로 저장하는 JSON 호환 형태.
 * radial일 때 angleDeg는 무시되지만 값은 보존한다(종류 전환 시 각도 유지).
 */
export type StudioGradientSpec = {
  type: GradientType;
  angleDeg: number;
  stops: GradientStop[];
};

/** 그라데이션을 입힐 요소의 로컬 bbox — x/y는 로컬 원점 기준 좌상단. */
export type GradientBBox = { x: number; y: number; width: number; height: number };

/** 색 단계 개수 범위 — 일러스트레이터식 멀티스톱(최소 2, 최대 5). */
export const GRADIENT_STOPS_MIN = 2;
export const GRADIENT_STOPS_MAX = 5;

/** 각도 슬라이더 범위 — 0..360°, 1° 단위. */
export const GRADIENT_ANGLE_RANGE: { min: number; max: number; step: number } = {
  min: 0,
  max: 360,
  step: 1,
};

/** 종류 선택 칩용 목록 — id와 한글 라벨. */
export const GRADIENT_TYPES: { id: GradientType; label: string }[] = [
  { id: "linear", label: "선형" },
  { id: "radial", label: "방사" },
];

/**
 * 기본 스펙 — 기존 텍스트 그라데이션 기본색(#ff3b30→#ffcc00)·세로 방향(180°)을 계승해
 * 구 문서와 첫 화면이 동일하게 보인다.
 */
export const DEFAULT_GRADIENT_SPEC: StudioGradientSpec = {
  type: "linear",
  angleDeg: 180,
  stops: [
    { offset: 0, color: "#ff3b30" },
    { offset: 1, color: "#ffcc00" },
  ],
};

// ---------------------------------------------------------------------------
// 프리셋 12종 — 멀티스톱 선형(다양한 각도) 8종 + 방사 4종
// ---------------------------------------------------------------------------

/** 프리셋 한 개 — 스펙 전체를 교체 적용한다(누적 아님). */
export type GradientEnginePreset = {
  id: string;
  label: string;
  tip: string;
  spec: StudioGradientSpec;
};

export const GRADIENT_ENGINE_PRESETS: GradientEnginePreset[] = [
  {
    id: "dawn-glow",
    label: "새벽 여명",
    tip: "짙은 남색에서 보라를 지나 여린 분홍으로 밝아오는 새벽.",
    spec: {
      type: "linear",
      angleDeg: 180,
      stops: [
        { offset: 0, color: "#16213e" },
        { offset: 0.55, color: "#7b4b94" },
        { offset: 1, color: "#f5b0bd" },
      ],
    },
  },
  {
    id: "blazing-sunset",
    label: "불타는 노을",
    tip: "금빛-주황-다홍-진보라 4단으로 타오르는 해질녘 하늘.",
    spec: {
      type: "linear",
      angleDeg: 180,
      stops: [
        { offset: 0, color: "#ffd166" },
        { offset: 0.38, color: "#ff7a3d" },
        { offset: 0.7, color: "#e63946" },
        { offset: 1, color: "#3a1d52" },
      ],
    },
  },
  {
    id: "neon-sign",
    label: "네온 사인",
    tip: "자홍-보라-시안으로 흐르는 사이버펑크 네온(가로).",
    spec: {
      type: "linear",
      angleDeg: 90,
      stops: [
        { offset: 0, color: "#ff2db3" },
        { offset: 0.5, color: "#8a2be2" },
        { offset: 1, color: "#19d3e6" },
      ],
    },
  },
  {
    id: "gold-foil",
    label: "금박",
    tip: "어두운 금-하이라이트-어두운 금 5단으로 번쩍이는 금속 광택 문자용.",
    spec: {
      type: "linear",
      angleDeg: 115,
      stops: [
        { offset: 0, color: "#7a4a05" },
        { offset: 0.28, color: "#ffd54a" },
        { offset: 0.5, color: "#fff3b0" },
        { offset: 0.72, color: "#e8a520" },
        { offset: 1, color: "#6b3c02" },
      ],
    },
  },
  {
    id: "chrome",
    label: "크롬",
    tip: "은빛 5단 반사로 매끈한 크롬 금속 질감(SF 로고·효과음).",
    spec: {
      type: "linear",
      angleDeg: 180,
      stops: [
        { offset: 0, color: "#e9edf2" },
        { offset: 0.3, color: "#8b97a5" },
        { offset: 0.5, color: "#f7fafc" },
        { offset: 0.7, color: "#5b6673" },
        { offset: 1, color: "#cfd6de" },
      ],
    },
  },
  {
    id: "rainbow-pop",
    label: "무지개 팝",
    tip: "빨강-노랑-초록-파랑-보라 5색이 가로로 흐르는 팝 무지개.",
    spec: {
      type: "linear",
      angleDeg: 90,
      stops: [
        { offset: 0, color: "#ff5a5f" },
        { offset: 0.25, color: "#ffb84a" },
        { offset: 0.5, color: "#7ad95d" },
        { offset: 0.75, color: "#38b6ff" },
        { offset: 1, color: "#b06bff" },
      ],
    },
  },
  {
    id: "mint-soda",
    label: "민트 소다",
    tip: "옅은 민트에서 청록으로 대각선(135°)으로 시원하게 떨어지는 소다.",
    spec: {
      type: "linear",
      angleDeg: 135,
      stops: [
        { offset: 0, color: "#d8fff1" },
        { offset: 0.55, color: "#6fe3c1" },
        { offset: 1, color: "#1f9e8e" },
      ],
    },
  },
  {
    id: "berry-milk",
    label: "딸기 우유",
    tip: "연분홍 3단이 대각선(45°)으로 녹아드는 파스텔 로맨스.",
    spec: {
      type: "linear",
      angleDeg: 45,
      stops: [
        { offset: 0, color: "#ffe3ef" },
        { offset: 0.5, color: "#ff9ec2" },
        { offset: 1, color: "#ff6fae" },
      ],
    },
  },
  {
    id: "deep-sea",
    label: "심해",
    tip: "밝은 청록 중심에서 짙은 남색 심해로 가라앉는 방사형.",
    spec: {
      type: "radial",
      angleDeg: 0,
      stops: [
        { offset: 0, color: "#27c4d6" },
        { offset: 0.55, color: "#0e5a8a" },
        { offset: 1, color: "#061f3d" },
      ],
    },
  },
  {
    id: "spotlight",
    label: "스포트라이트",
    tip: "무대 조명 — 눈부신 중심광이 어둠 속으로 잦아드는 방사형.",
    spec: {
      type: "radial",
      angleDeg: 0,
      stops: [
        { offset: 0, color: "#fff7d6" },
        { offset: 0.45, color: "#ffd54a" },
        { offset: 1, color: "#262014" },
      ],
    },
  },
  {
    id: "cherry-glow",
    label: "앵두 글로우",
    tip: "발그레한 중심에서 자두빛 테두리로 물드는 방사형 홍조.",
    spec: {
      type: "radial",
      angleDeg: 0,
      stops: [
        { offset: 0, color: "#ffd1dc" },
        { offset: 0.55, color: "#ff6f91" },
        { offset: 1, color: "#7a1c3a" },
      ],
    },
  },
  {
    id: "ink-wash",
    label: "먹 번짐",
    tip: "한지 위 먹이 중심에서 바깥으로 번져 짙어지는 수묵 방사형.",
    spec: {
      type: "radial",
      angleDeg: 0,
      stops: [
        { offset: 0, color: "#f5f2ea" },
        { offset: 0.55, color: "#8d8578" },
        { offset: 1, color: "#1a1713" },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// 색 유틸 — 헥스 정규화·보간
// ---------------------------------------------------------------------------

/** #rgb/#rrggbb(대소문자 무관)를 소문자 #rrggbb로 정규화. 무효하면 fallback. */
export function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !isHexColor(value)) return fallback;
  const hex = value.toLowerCase();
  if (hex.length === 7) return hex;
  // #rgb → #rrggbb 확장
  return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
}

/** 두 헥스 색을 t(0..1)로 선형 보간 — 스톱 추가 시 중간색 생성용. */
export function mixHexColors(a: string, b: string, t: number): string {
  const ha = normalizeHexColor(a, "#000000");
  const hb = normalizeHexColor(b, "#ffffff");
  const ratio = clamp01(t);
  const channel = (from: number, to: number): string => {
    const va = parseInt(ha.slice(from, to), 16);
    const vb = parseInt(hb.slice(from, to), 16);
    return Math.round(va + (vb - va) * ratio)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1, 3)}${channel(3, 5)}${channel(5, 7)}`;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** 각도를 [0, 360) 범위로 감싼다(음수·초과 허용). */
export function wrapAngleDeg(angle: number): number {
  if (!Number.isFinite(angle)) return DEFAULT_GRADIENT_SPEC.angleDeg;
  return ((angle % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// 스펙 검증·정규화
// ---------------------------------------------------------------------------

/** 직렬화 스펙 형태인지 구조 검사 — 문서 로드/역직렬화 게이트용(느슨한 유효성은 normalize가 담당). */
export function isGradientSpec(value: unknown): value is StudioGradientSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.type !== "linear" && v.type !== "radial") return false;
  if (typeof v.angleDeg !== "number" || !Number.isFinite(v.angleDeg)) return false;
  if (!Array.isArray(v.stops) || v.stops.length < 1) return false;
  return v.stops.every(
    (s) =>
      typeof s === "object" &&
      s !== null &&
      typeof (s as GradientStop).offset === "number" &&
      Number.isFinite((s as GradientStop).offset) &&
      typeof (s as GradientStop).color === "string"
  );
}

/**
 * 어떤 입력이든 안전한 스펙으로 정규화한 새 객체를 돌려준다(입력 무변이).
 * - type: linear/radial 외 → linear
 * - angleDeg: 유한수 → [0,360) 감싸기, 아니면 180
 * - stops: 유효(유한 offset + 헥스 색)만 채택 → offset 0..1 클램프 → 오름차순 정렬
 *   → 최대 5개. 유효 스톱이 2개 미만이면 기본 스톱으로 대체.
 */
export function normalizeGradientSpec(value: unknown): StudioGradientSpec {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const type: GradientType = raw.type === "radial" ? "radial" : "linear";
  const angleDeg = wrapAngleDeg(typeof raw.angleDeg === "number" ? raw.angleDeg : NaN);
  const rawStops = Array.isArray(raw.stops) ? raw.stops : [];
  const stops = rawStops
    .filter(
      (s): s is GradientStop =>
        typeof s === "object" &&
        s !== null &&
        typeof (s as GradientStop).offset === "number" &&
        Number.isFinite((s as GradientStop).offset) &&
        typeof (s as GradientStop).color === "string" &&
        isHexColor((s as GradientStop).color)
    )
    .map((s) => ({ offset: clamp01(s.offset), color: normalizeHexColor(s.color, "#000000") }))
    .sort((a, b) => a.offset - b.offset)
    .slice(0, GRADIENT_STOPS_MAX);
  return {
    type,
    angleDeg,
    stops: stops.length >= GRADIENT_STOPS_MIN ? stops : DEFAULT_GRADIENT_SPEC.stops.map((s) => ({ ...s })),
  };
}

/** 두 스펙이 시각적으로 동일한지(정규화 후 깊은 비교) — 패널의 활성 프리셋 표시용. */
export function gradientSpecsEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  const na = normalizeGradientSpec(a);
  const nb = normalizeGradientSpec(b);
  if (na.type !== nb.type || na.stops.length !== nb.stops.length) return false;
  // radial은 각도를 쓰지 않으므로 각도 차이를 무시한다.
  if (na.type === "linear" && na.angleDeg !== nb.angleDeg) return false;
  return na.stops.every((s, i) => s.color === nb.stops[i].color && Math.abs(s.offset - nb.stops[i].offset) < 1e-6);
}

// ---------------------------------------------------------------------------
// 기하 — CSS linear-gradient 알고리즘과 동일한 선형 축, farthest-corner 방사
// ---------------------------------------------------------------------------

const snapZero = (v: number): number => (Math.abs(v) < 1e-9 ? 0 : v);

/**
 * 선형 그라데이션의 시작/끝 점 — CSS linear-gradient(angle)와 동일한 기하.
 * 그라데이션 축은 bbox 중심을 지나고, 축 길이는 |w·sinA| + |h·cosA|
 * (CSS 명세의 gradient line length)라서 모든 모서리가 0..1 안에 든다.
 */
export function linearGradientPoints(
  spec: Pick<StudioGradientSpec, "angleDeg">,
  bbox: GradientBBox
): { start: { x: number; y: number }; end: { x: number; y: number } } {
  const rad = (wrapAngleDeg(spec.angleDeg) * Math.PI) / 180;
  // CSS 규약: 0°=위, 90°=오른쪽(캔버스 y축은 아래가 +라 dirY에 -cos).
  const dirX = snapZero(Math.sin(rad));
  const dirY = snapZero(-Math.cos(rad));
  const half = (Math.abs(bbox.width * dirX) + Math.abs(bbox.height * dirY)) / 2;
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  return {
    start: { x: cx - dirX * half, y: cy - dirY * half },
    end: { x: cx + dirX * half, y: cy + dirY * half },
  };
}

/**
 * 방사 그라데이션 기하 — 중심은 bbox 중앙, 끝 반지름은 가장 먼 꼭짓점까지
 * (CSS radial-gradient(circle) 기본 farthest-corner와 동일 → 미리보기와 일치).
 */
export function radialGradientGeometry(bbox: GradientBBox): {
  center: { x: number; y: number };
  startRadius: number;
  endRadius: number;
} {
  return {
    center: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
    startRadius: 0,
    endRadius: Math.hypot(bbox.width / 2, bbox.height / 2),
  };
}

// ---------------------------------------------------------------------------
// 산출물 1 — Konva fill* props
// ---------------------------------------------------------------------------

/** Konva 노드에 스프레드할 그라데이션 채우기 props(미적용이면 전부 없음). */
export type KonvaGradientFillProps = {
  fillPriority?: "linear-gradient" | "radial-gradient";
  fillLinearGradientStartPoint?: { x: number; y: number };
  fillLinearGradientEndPoint?: { x: number; y: number };
  fillLinearGradientColorStops?: Array<number | string>;
  fillRadialGradientStartPoint?: { x: number; y: number };
  fillRadialGradientEndPoint?: { x: number; y: number };
  fillRadialGradientStartRadius?: number;
  fillRadialGradientEndRadius?: number;
  fillRadialGradientColorStops?: Array<number | string>;
};

/** 스톱 배열 → Konva colorStops 평탄 배열([offset, color, offset, color, ...]). */
export function flattenColorStops(stops: GradientStop[]): Array<number | string> {
  return stops.flatMap((s) => [s.offset, s.color]);
}

/**
 * 스펙 → Konva fill props. null/undefined면 빈 객체를 돌려줘 스프레드가 no-op이 된다
 * (react-konva는 사라진 prop을 기본값으로 되돌리므로 그라데이션 해제도 자동 처리).
 * fillPriority를 명시해 fill(단색)이 함께 있어도 그라데이션이 이긴다.
 */
export function konvaGradientProps(
  spec: StudioGradientSpec | null | undefined,
  bbox: GradientBBox
): KonvaGradientFillProps {
  if (spec == null) return {};
  const safe = normalizeGradientSpec(spec);
  const colorStops = flattenColorStops(safe.stops);
  if (safe.type === "radial") {
    const { center, startRadius, endRadius } = radialGradientGeometry(bbox);
    return {
      fillPriority: "radial-gradient",
      fillRadialGradientStartPoint: center,
      fillRadialGradientEndPoint: center,
      fillRadialGradientStartRadius: startRadius,
      fillRadialGradientEndRadius: endRadius,
      fillRadialGradientColorStops: colorStops,
    };
  }
  const { start, end } = linearGradientPoints(safe, bbox);
  return {
    fillPriority: "linear-gradient",
    fillLinearGradientStartPoint: start,
    fillLinearGradientEndPoint: end,
    fillLinearGradientColorStops: colorStops,
  };
}

// ---------------------------------------------------------------------------
// 산출물 2 — canvas 2D ctx 파라미터/적용
// ---------------------------------------------------------------------------

/** createLinearGradient(x0,y0,x1,y1) / createRadialGradient(x0,y0,r0,x1,y1,r1) 인자 묶음. */
export type CanvasGradientParams =
  | { type: "linear"; x0: number; y0: number; x1: number; y1: number; stops: GradientStop[] }
  | {
      type: "radial";
      x0: number;
      y0: number;
      r0: number;
      x1: number;
      y1: number;
      r1: number;
      stops: GradientStop[];
    };

/** 스펙 + 요소 bbox → 2D 컨텍스트 그라데이션 생성 인자(순수 계산, ctx 불필요). */
export function canvasGradientParams(spec: StudioGradientSpec, bbox: GradientBBox): CanvasGradientParams {
  const safe = normalizeGradientSpec(spec);
  if (safe.type === "radial") {
    const { center, startRadius, endRadius } = radialGradientGeometry(bbox);
    return {
      type: "radial",
      x0: center.x,
      y0: center.y,
      r0: startRadius,
      x1: center.x,
      y1: center.y,
      r1: endRadius,
      stops: safe.stops,
    };
  }
  const { start, end } = linearGradientPoints(safe, bbox);
  return { type: "linear", x0: start.x, y0: start.y, x1: end.x, y1: end.y, stops: safe.stops };
}

/** addColorStop만 요구하는 최소 그라데이션 형태 — DOM CanvasGradient와 구조 호환. */
export type CanvasGradientLike = { addColorStop(offset: number, color: string): void };

/** create*Gradient만 요구하는 최소 컨텍스트 형태 — DOM/오프스크린/노드 캔버스 모두 만족. */
export type GradientCapableContext = {
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradientLike;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradientLike;
};

/**
 * 스펙을 실제 ctx 그라데이션 객체로 만들어 스톱까지 채워 돌려준다.
 * 호출부는 반환값을 fillStyle에 대입하면 된다(내보내기·오프스크린 합성용).
 */
export function applyCanvasGradient<C extends GradientCapableContext>(
  ctx: C,
  spec: StudioGradientSpec,
  bbox: GradientBBox
): CanvasGradientLike {
  const params = canvasGradientParams(spec, bbox);
  const gradient =
    params.type === "radial"
      ? ctx.createRadialGradient(params.x0, params.y0, params.r0, params.x1, params.y1, params.r1)
      : ctx.createLinearGradient(params.x0, params.y0, params.x1, params.y1);
  for (const stop of params.stops) gradient.addColorStop(stop.offset, stop.color);
  return gradient;
}

// ---------------------------------------------------------------------------
// 산출물 3 — CSS gradient 문자열(패널 미리보기·프리셋 스와치)
// ---------------------------------------------------------------------------

/** offset(0..1) → "12.5%" (소수 둘째 자리까지, 후행 0 제거). */
function formatPercent(offset: number): string {
  return `${Math.round(clamp01(offset) * 10000) / 100}%`;
}

/** 스펙 → CSS background 값. 선형은 동일 각도, 방사는 circle(farthest-corner)로 캔버스와 일치. */
export function gradientToCss(spec: StudioGradientSpec): string {
  const safe = normalizeGradientSpec(spec);
  const stops = safe.stops.map((s) => `${s.color} ${formatPercent(s.offset)}`).join(", ");
  if (safe.type === "radial") return `radial-gradient(circle, ${stops})`;
  return `linear-gradient(${safe.angleDeg}deg, ${stops})`;
}

// ---------------------------------------------------------------------------
// 패널 편집 헬퍼 — 전부 새 스펙 반환(무변이). no-op이면 입력 참조 그대로 반환.
// ---------------------------------------------------------------------------

/** 종류 전환 — 각도·스톱은 보존한다. */
export function setGradientType(spec: StudioGradientSpec, type: GradientType): StudioGradientSpec {
  const safe = normalizeGradientSpec(spec);
  return { ...safe, type };
}

/** 각도 변경(선형용) — [0,360)으로 감싼다. */
export function setGradientAngle(spec: StudioGradientSpec, angleDeg: number): StudioGradientSpec {
  const safe = normalizeGradientSpec(spec);
  return { ...safe, angleDeg: wrapAngleDeg(angleDeg) };
}

/**
 * 스톱 한 개 수정. offset은 이웃 스톱 사이로 클램프해 순서(오름차순)를 항상 보존한다
 * — 슬라이더를 끌어도 행 인덱스가 뒤바뀌지 않는 일러스트레이터식 동작.
 */
export function updateGradientStop(
  spec: StudioGradientSpec,
  index: number,
  patch: Partial<GradientStop>
): StudioGradientSpec {
  const safe = normalizeGradientSpec(spec);
  if (index < 0 || index >= safe.stops.length) return spec;
  const prev = index > 0 ? safe.stops[index - 1].offset : 0;
  const next = index < safe.stops.length - 1 ? safe.stops[index + 1].offset : 1;
  const current = safe.stops[index];
  const offset =
    typeof patch.offset === "number" && Number.isFinite(patch.offset)
      ? Math.min(next, Math.max(prev, clamp01(patch.offset)))
      : current.offset;
  const color = patch.color !== undefined ? normalizeHexColor(patch.color, current.color) : current.color;
  const stops = safe.stops.map((s, i) => (i === index ? { offset, color } : s));
  return { ...safe, stops };
}

/**
 * 가장 넓은 구간의 중앙에 이웃 두 색의 중간색 스톱을 추가한다.
 * 이미 최대(5개)면 입력을 그대로 반환(no-op).
 */
export function addGradientStop(spec: StudioGradientSpec): StudioGradientSpec {
  const safe = normalizeGradientSpec(spec);
  if (safe.stops.length >= GRADIENT_STOPS_MAX) return spec;
  let gapIndex = 0;
  let gapSize = -1;
  for (let i = 0; i < safe.stops.length - 1; i += 1) {
    const gap = safe.stops[i + 1].offset - safe.stops[i].offset;
    if (gap > gapSize) {
      gapSize = gap;
      gapIndex = i;
    }
  }
  const a = safe.stops[gapIndex];
  const b = safe.stops[gapIndex + 1];
  const inserted: GradientStop = {
    offset: (a.offset + b.offset) / 2,
    color: mixHexColors(a.color, b.color, 0.5),
  };
  const stops = [...safe.stops.slice(0, gapIndex + 1), inserted, ...safe.stops.slice(gapIndex + 1)];
  return { ...safe, stops };
}

/** 스톱 제거 — 최소(2개) 이하로는 줄이지 않고 입력을 그대로 반환(no-op). */
export function removeGradientStop(spec: StudioGradientSpec, index: number): StudioGradientSpec {
  const safe = normalizeGradientSpec(spec);
  if (safe.stops.length <= GRADIENT_STOPS_MIN) return spec;
  if (index < 0 || index >= safe.stops.length) return spec;
  return { ...safe, stops: safe.stops.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------------------
// StudioPage 통합 헬퍼 — 구 텍스트 그라데이션 호환 + 텍스트 bbox 추정
// ---------------------------------------------------------------------------

/**
 * 기존 TextEl 2색 그라데이션 필드(gradientColorStart/End + vertical/horizontal)를
 * 엔진 스펙으로 변환 — 구 문서가 새 렌더 경로에서 동일하게 보이도록 한다.
 * 기본색·방향 기본값(vertical)은 기존 StudioPage 렌더 폴백과 동일하다.
 */
export function legacyTextGradientToSpec(
  start: string | undefined,
  end: string | undefined,
  direction: "vertical" | "horizontal" | undefined
): StudioGradientSpec {
  return {
    type: "linear",
    angleDeg: direction === "horizontal" ? 90 : 180,
    stops: [
      { offset: 0, color: normalizeHexColor(start, "#ff3b30") },
      { offset: 1, color: normalizeHexColor(end, "#ffcc00") },
    ],
  };
}

/**
 * Konva.Text 로컬 bbox 추정 — 원점(0,0)에서 시작하고 높이는
 * max(fontSize×1.3(기존 한 줄 규약), 줄수×fontSize×lineHeight)로 여러 줄도 덮는다.
 */
export function estimateTextGradientBBox(input: {
  width: number;
  text: string;
  fontSize: number;
  lineHeight?: number;
}): GradientBBox {
  const lineCount = Math.max(1, input.text.split("\n").length);
  const lineHeight = input.lineHeight ?? 1;
  const height = Math.max(input.fontSize * 1.3, lineCount * input.fontSize * lineHeight);
  return { x: 0, y: 0, width: Math.max(1, input.width), height: Math.max(1, height) };
}
