/**
 * Studio Pattern Fill — 일러스트레이터급 패턴 채우기(스와치) 엔진.
 * 도형 채우기에 쓰는 타일링 가능한 SVG 패턴 카탈로그를 스와치로 제공하고,
 * 전경/배경색 주입 + 배율을 하나의 직렬화 스펙(StudioPatternSpec)으로 다룬다.
 *
 * 산출물 4종(전부 순수 함수, Konva/DOM 무의존):
 *  1. SVG 타일 문자열/data URL — 스펙의 fg/bg 색을 주입한 "타일 1장" SVG.
 *     studio-tones(큰 시트에 <pattern> 내장)와 달리 타일 자체가 이미지라서
 *     Konva fillPatternImage·CSS background-repeat 양쪽에서 그대로 반복된다.
 *  2. Konva fillPattern* props 계획 — 로드된 타일 이미지를 받아 스프레드용 props를
 *     만든다. fillPriority="pattern"이라 그라데이션(fillPriority=*-gradient)·단색(fill)이
 *     함께 있어도 패턴이 이긴다(우선순위 규약: pattern > gradient > fill 단색).
 *     이미지 미로드(null)면 빈 객체 → 호출부의 fill/그라데이션 폴백이 유지된다.
 *  3. 이미지 로더(주입형) — 순수 모듈이라 DOM Image를 직접 만들지 않고,
 *     HTMLImageElement와 구조 호환하는 팩토리(PatternImageFactory)를 주입받는다.
 *     브라우저는 () => new Image(), 테스트는 가짜 이미지를 넘긴다.
 *  4. CSS 미리보기 스타일 — 패널 스와치/라이브 미리보기가 캔버스와 동일 타일을 쓴다.
 *
 * 직렬화/하위호환: 스펙은 JSON 그대로 요소(El)에 저장한다. 구 문서에는 pattern
 * 필드가 없으므로(undefined) 아무 것도 그리지 않고, normalizePatternSpec이
 * 알 수 없는 patternId/무효 색/배율을 안전한 기본값으로 되돌린다(로드 게이트).
 */

import { normalizeHexColor } from "./studio-gradient-engine";
import { isHexColor } from "./studio-gradients";

// ---------------------------------------------------------------------------
// 타입·상수
// ---------------------------------------------------------------------------

/** 패턴 종류 — 스와치 그리드에 노출되는 고정 id 유니언. */
export type StudioPatternId =
  | "dots"
  | "stripes"
  | "diagonal"
  | "grid"
  | "herringbone"
  | "raindrops"
  | "stars"
  | "hearts"
  | "sand"
  | "crosshatch"
  | "triangles"
  | "checker"
  | "polka"
  | "vertical-stripes"
  | "waves"
  | "scallops"
  | "bricks"
  | "honeycomb"
  | "diamonds"
  | "confetti"
  | "sparkles"
  | "clouds"
  | "lightning"
  | "speed-lines";

/**
 * 직렬화 패턴 스펙 — 요소(El)에 그대로 저장하는 JSON 호환 형태.
 * bg 미설정이면 타일 배경이 투명해서 마크(잉크) 사이로 아래 요소가 비쳐 보인다
 * (스크린톤처럼 겹쳐 쓰는 용도). scale은 타일 배율(1 = 원본 크기).
 */
export type StudioPatternSpec = {
  patternId: StudioPatternId;
  fg: string;
  bg?: string;
  scale: number;
};

/** 패턴 정의 한 개 — tile은 정사각 타일 한 변(px), inner는 fg 색을 주입한 타일 내부 마크업. */
export type StudioPatternDef = {
  id: StudioPatternId;
  label: string;
  tip: string;
  keywords?: readonly string[];
  tile: number;
  inner: (fg: string) => string;
};

/** 배율 슬라이더 범위 — 0.25×(촘촘)~4×(성김), 0.05 단위. */
export const PATTERN_SCALE_RANGE: { min: number; max: number; step: number } = {
  min: 0.25,
  max: 4,
  step: 0.05,
};

/** 기본 전경(잉크)색 — 스튜디오 기본 잉크(#16100c)와 동일해 선·글자와 톤이 맞는다. */
export const DEFAULT_PATTERN_FG = "#16100c";

/** 기본 스펙 — 도트 패턴·기본 잉크·투명 배경·원본 배율. */
export const DEFAULT_PATTERN_SPEC: StudioPatternSpec = {
  patternId: "dots",
  fg: DEFAULT_PATTERN_FG,
  scale: 1,
};

// 소수 셋째 자리에서 끊어 SVG 좌표 문자열을 짧게(불필요한 0 제거: 3.000 → "3").
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// 타일 내부 마크업 빌더 — 전부 결정적(랜덤 없음). 좌표는 타일 경계에서 끊김 없이
// 이어지도록(마크가 타일 안에 완전히 들어가거나, 선 주기가 타일 크기를 나누도록) 잡았다.
// ---------------------------------------------------------------------------

/** 45°(↘) 평행선 — s×s 타일 대각선 + 두 모서리 보정선(경계 이어짐, studio-tones 규약). */
function diagonal45Lines(fg: string, s: number, strokeWidth: number): string {
  const w = `stroke="${fg}" stroke-width="${num(strokeWidth)}"`;
  return (
    `<line x1="0" y1="0" x2="${num(s)}" y2="${num(s)}" ${w}/>` +
    `<line x1="${num(-s)}" y1="0" x2="${num(s)}" y2="${num(s * 2)}" ${w}/>` +
    `<line x1="0" y1="${num(-s)}" x2="${num(s * 2)}" y2="${num(s)}" ${w}/>`
  );
}

/** 135°(↙) 평행선 — 45°의 좌우 반전. */
function diagonal135Lines(fg: string, s: number, strokeWidth: number): string {
  const w = `stroke="${fg}" stroke-width="${num(strokeWidth)}"`;
  return (
    `<line x1="0" y1="${num(s)}" x2="${num(s)}" y2="0" ${w}/>` +
    `<line x1="0" y1="${num(s * 2)}" x2="${num(s * 2)}" y2="0" ${w}/>` +
    `<line x1="${num(-s)}" y1="${num(s)}" x2="${num(s)}" y2="${num(-s)}" ${w}/>`
  );
}

/** 5각 별 꼭짓점 좌표열("x,y x,y ...") — 위쪽 꼭짓점부터 외곽/내곽 반지름 교대. */
function starPolygonPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.round((cx + radius * Math.cos(angle)) * 100) / 100;
    const y = Math.round((cy + radius * Math.sin(angle)) * 100) / 100;
    points.push(`${x},${y}`);
  }
  return points.join(" ");
}

/** 모래(스티플) 도트 배치 — 결정적 하드코딩 산포([cx, cy, r]). 전부 20px 타일 안쪽. */
const SAND_DOTS: ReadonlyArray<readonly [number, number, number]> = [
  [2.2, 3.1, 0.9],
  [6.8, 1.8, 0.7],
  [11.5, 3.6, 1],
  [16.4, 2.2, 0.8],
  [4.1, 7.9, 0.8],
  [9.2, 6.7, 1.1],
  [14.8, 8.1, 0.7],
  [18.2, 6.3, 0.9],
  [2.8, 12.4, 1],
  [7.4, 11.2, 0.7],
  [12.1, 13.5, 0.9],
  [17.3, 12, 0.8],
  [5.2, 16.8, 0.9],
  [10.6, 17.5, 0.8],
  [15.4, 16.2, 1],
  [18.6, 17.8, 0.7],
];

/** 헤링본 사선 세그먼트 — 16px 타일, 폭 8 두 기둥이 반 주기(4px) 어긋난 V자 직물 결. */
const HERRINGBONE_SEGMENTS: ReadonlyArray<readonly [number, number, number, number]> = [
  // 왼쪽 기둥(x 0..8): ↗ 방향(주기 8, y ≡ 0 mod 8)
  [0, 0, 8, -8],
  [0, 8, 8, 0],
  [0, 16, 8, 8],
  [0, 24, 8, 16],
  // 오른쪽 기둥(x 8..16): ↘ 방향(반 주기 어긋남, y ≡ 4 mod 8)
  [8, -4, 16, 4],
  [8, 4, 16, 12],
  [8, 12, 16, 20],
  [8, 20, 16, 28],
];

// ---------------------------------------------------------------------------
// 패턴 스와치 — 기본 기하, 만화 연출, 장식, 재질 순서. 각 타일은 self-contained SVG다.
// ---------------------------------------------------------------------------

export const STUDIO_PATTERNS: StudioPatternDef[] = [
  {
    id: "dots",
    label: "도트",
    tip: "반 칸씩 어긋난 물방울 무늬 도트 — 배경·옷감의 기본 패턴.",
    tile: 16,
    inner: (fg) => `<circle cx="4" cy="4" r="2.2" fill="${fg}"/><circle cx="12" cy="12" r="2.2" fill="${fg}"/>`,
  },
  {
    id: "stripes",
    label: "스트라이프",
    tip: "같은 폭으로 반복되는 가로 줄무늬 — 티셔츠·차양막 느낌.",
    tile: 12,
    inner: (fg) => `<rect x="0" y="0" width="12" height="6" fill="${fg}"/>`,
  },
  {
    id: "diagonal",
    label: "사선",
    tip: "45° 방향 평행 사선 — 속도감·해칭 음영.",
    tile: 12,
    inner: (fg) => diagonal45Lines(fg, 12, 2.5),
  },
  {
    id: "grid",
    label: "격자",
    tip: "가는 가로·세로 선이 만나는 모눈 — 노트·타일 바닥.",
    tile: 14,
    inner: (fg) =>
      `<line x1="0" y1="7" x2="14" y2="7" stroke="${fg}" stroke-width="1.6"/>` +
      `<line x1="7" y1="0" x2="7" y2="14" stroke="${fg}" stroke-width="1.6"/>`,
  },
  {
    id: "herringbone",
    label: "헤링본",
    tip: "반 칸씩 어긋난 V자 직물 결 — 코트·마룻바닥 질감.",
    tile: 16,
    inner: (fg) =>
      HERRINGBONE_SEGMENTS.map(
        ([x1, y1, x2, y2]) =>
          `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke="${fg}" stroke-width="2.4"/>`
      ).join(""),
  },
  {
    id: "raindrops",
    label: "물방울",
    tip: "또르르 맺힌 빗방울 — 비 오는 장면·상쾌한 배경.",
    tile: 18,
    inner: (fg) =>
      `<path d="M9 2.6 C11.3 6 12.5 8.2 12.5 10.4 A3.5 3.5 0 1 1 5.5 10.4 C5.5 8.2 6.7 6 9 2.6 Z" fill="${fg}"/>`,
  },
  {
    id: "stars",
    label: "별",
    tip: "콕콕 박힌 5각 별 — 밤하늘·반짝이는 연출.",
    tile: 18,
    inner: (fg) => `<polygon points="${starPolygonPoints(9, 9, 6, 2.5)}" fill="${fg}"/>`,
  },
  {
    id: "hearts",
    label: "하트",
    tip: "동글동글 하트 — 로맨스·설렘 배경.",
    tile: 16,
    inner: (fg) =>
      `<path d="M8 13.4 C5.1 10.9 2.7 8.9 2.7 6.5 C2.7 4.7 4.1 3.4 5.7 3.4 C6.7 3.4 7.5 3.9 8 4.8 C8.5 3.9 9.3 3.4 10.3 3.4 C11.9 3.4 13.3 4.7 13.3 6.5 C13.3 8.9 10.9 10.9 8 13.4 Z" fill="${fg}"/>`,
  },
  {
    id: "sand",
    label: "모래",
    tip: "굵기가 다른 알갱이가 흩어진 스티플 — 모래밭·까끌한 질감.",
    tile: 20,
    inner: (fg) =>
      SAND_DOTS.map(([cx, cy, r]) => `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${fg}"/>`).join(""),
  },
  {
    id: "crosshatch",
    label: "빗금 교차",
    tip: "45°와 135° 빗금이 교차하는 크로스해칭 — 잉크 음영.",
    tile: 12,
    inner: (fg) => diagonal45Lines(fg, 12, 1.8) + diagonal135Lines(fg, 12, 1.8),
  },
  {
    id: "triangles",
    label: "삼각",
    tip: "줄지어 선 세모 — 기하학 포스터·산맥 무늬.",
    tile: 16,
    inner: (fg) => `<path d="M8 3 L13.6 13 L2.4 13 Z" fill="${fg}"/>`,
  },
  {
    id: "checker",
    label: "체크",
    tip: "두 칸씩 교차하는 체커보드 — 깃발·픽셀 무드.",
    tile: 16,
    inner: (fg) => `<rect x="0" y="0" width="8" height="8" fill="${fg}"/><rect x="8" y="8" width="8" height="8" fill="${fg}"/>`,
  },
  {
    id: "polka",
    label: "큰 물방울",
    tip: "여백이 넉넉한 큰 폴카 도트 — 팝아트·레트로 배경.",
    keywords: ["polka", "pop", "도트", "레트로"],
    tile: 24,
    inner: (fg) => `<circle cx="6" cy="6" r="4.4" fill="${fg}"/><circle cx="18" cy="18" r="4.4" fill="${fg}"/>`,
  },
  {
    id: "vertical-stripes",
    label: "세로 줄무늬",
    tip: "세로로 길게 이어지는 줄무늬 — 벽지·의상·속도 배경.",
    keywords: ["vertical", "stripe", "세로", "줄무늬"],
    tile: 16,
    inner: (fg) => `<rect x="0" y="0" width="7" height="16" fill="${fg}"/>`,
  },
  {
    id: "waves",
    label: "물결",
    tip: "부드럽게 이어지는 사인 곡선 — 물·바람·잔잔한 감정.",
    keywords: ["wave", "water", "바다", "파동"],
    tile: 24,
    inner: (fg) => `<path d="M0 12 C4 4 8 4 12 12 S20 20 24 12" fill="none" stroke="${fg}" stroke-width="2.4"/>`,
  },
  {
    id: "scallops",
    label: "부채 비늘",
    tip: "반원 호가 겹치는 세이게이하풍 패턴 — 물결·판타지 의상.",
    keywords: ["scallop", "scale", "비늘", "부채"],
    tile: 24,
    inner: (fg) => `<path d="M0 12 A12 12 0 0 1 24 12 M-12 24 A12 12 0 0 1 12 24 M12 24 A12 12 0 0 1 36 24" fill="none" stroke="${fg}" stroke-width="2"/>`,
  },
  {
    id: "bricks",
    label: "벽돌",
    tip: "반 칸씩 어긋난 벽돌 줄눈 — 건물·골목·인더스트리얼 배경.",
    keywords: ["brick", "wall", "벽", "건물"],
    tile: 32,
    inner: (fg) => `<path d="M0 0 H32 V32 H0 Z M0 16 H32 M16 0 V16 M8 16 V32 M24 16 V32" fill="none" stroke="${fg}" stroke-width="2"/>`,
  },
  {
    id: "honeycomb",
    label: "벌집",
    tip: "육각 셀이 맞물리는 허니컴 — SF 인터페이스·테크 장면.",
    keywords: ["honeycomb", "hex", "육각", "테크"],
    tile: 28,
    inner: (fg) => `<path d="M7 1 H21 L28 14 L21 27 H7 L0 14 Z M21 1 L28 -12 L35 1 L28 14 Z M21 27 L28 14 L35 27 L28 40 Z" fill="none" stroke="${fg}" stroke-width="2"/>`,
  },
  {
    id: "diamonds",
    label: "다이아",
    tip: "마름모가 반복되는 아가일 골격 — 패션·레트로 포스터.",
    keywords: ["diamond", "argyle", "마름모", "아가일"],
    tile: 20,
    inner: (fg) => `<path d="M10 1 L19 10 L10 19 L1 10 Z" fill="none" stroke="${fg}" stroke-width="2.2"/>`,
  },
  {
    id: "confetti",
    label: "컨페티",
    tip: "짧은 조각이 흩어진 축하 패턴 — 파티·성공·활기.",
    keywords: ["confetti", "party", "축하", "조각"],
    tile: 24,
    inner: (fg) => `<path d="M3 5 L8 9 M15 3 L13 9 M20 12 L15 15 M5 16 L4 22 M12 19 L18 22" fill="none" stroke="${fg}" stroke-width="2.8" stroke-linecap="round"/>`,
  },
  {
    id: "sparkles",
    label: "스파클",
    tip: "크기가 다른 네 갈래 반짝임 — 마법·하이라이트·클린 연출.",
    keywords: ["sparkle", "shine", "반짝", "마법"],
    tile: 28,
    inner: (fg) => `<path d="M8 1 L10 7 L16 9 L10 11 L8 17 L6 11 L0 9 L6 7 Z M21 14 L22.5 18.5 L27 20 L22.5 21.5 L21 26 L19.5 21.5 L15 20 L19.5 18.5 Z" fill="${fg}"/>`,
  },
  {
    id: "clouds",
    label: "구름",
    tip: "작은 구름 실루엣이 반복되는 하늘·꿈 장면 패턴.",
    keywords: ["cloud", "sky", "구름", "꿈"],
    tile: 36,
    inner: (fg) => `<path d="M5 24 C1 24 0 18 4 16 C3 10 10 7 14 11 C17 5 27 7 27 14 C34 14 35 24 29 24 Z" fill="${fg}"/>`,
  },
  {
    id: "lightning",
    label: "번개",
    tip: "작은 지그재그 번개 — 액션·분노·에너지 배경.",
    keywords: ["lightning", "electric", "번개", "에너지"],
    tile: 24,
    inner: (fg) => `<path d="M14 1 L5 13 H11 L8 23 L20 9 H14 Z" fill="${fg}"/>`,
  },
  {
    id: "speed-lines",
    label: "속도선",
    tip: "길이가 다른 가로선이 반복되는 만화식 이동·긴장 배경.",
    keywords: ["speed", "motion", "속도", "액션"],
    tile: 32,
    inner: (fg) => `<path d="M0 5 H26 M8 13 H32 M0 21 H20 M13 29 H32" fill="none" stroke="${fg}" stroke-width="2.4" stroke-linecap="round"/>`,
  },
];

/** 패턴 id 목록(스와치 순서) — 정규화·검증이 공유한다. */
export const STUDIO_PATTERN_IDS: readonly StudioPatternId[] = STUDIO_PATTERNS.map((def) => def.id);

const PATTERN_BY_ID = new Map<StudioPatternId, StudioPatternDef>(STUDIO_PATTERNS.map((def) => [def.id, def]));

/** id → 패턴 정의. 알 수 없는 id는 기본 패턴(도트)으로 폴백한다(구 문서 안전). */
export function getPatternDef(id: string): StudioPatternDef {
  return PATTERN_BY_ID.get(id as StudioPatternId) ?? STUDIO_PATTERNS[0];
}

/** Local catalog search for a growing pattern library. Every whitespace-separated term must match. */
export function searchStudioPatterns(query: string): StudioPatternDef[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return STUDIO_PATTERNS;
  return STUDIO_PATTERNS.filter((definition) => {
    const searchable = [
      definition.id,
      definition.label,
      definition.tip,
      ...(definition.keywords ?? []),
    ].join(" ").toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

// ---------------------------------------------------------------------------
// 스펙 검증·정규화·비교 — 문서(localStorage/JSON) 로드 게이트
// ---------------------------------------------------------------------------

/** 배율을 슬라이더 범위로 클램프. 무한/NaN은 기본 배율(1)로. */
export function clampPatternScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PATTERN_SPEC.scale;
  return Math.min(PATTERN_SCALE_RANGE.max, Math.max(PATTERN_SCALE_RANGE.min, value));
}

/** 직렬화 스펙 형태인지 구조 검사 — 역직렬화 게이트용(세부 보정은 normalize가 담당). */
export function isPatternSpec(value: unknown): value is StudioPatternSpec {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.patternId !== "string" || !STUDIO_PATTERN_IDS.includes(v.patternId as StudioPatternId)) return false;
  if (typeof v.fg !== "string") return false;
  if (v.bg !== undefined && typeof v.bg !== "string") return false;
  return typeof v.scale === "number" && Number.isFinite(v.scale);
}

/**
 * 어떤 입력이든 안전한 스펙으로 정규화한 새 객체를 돌려준다(입력 무변이, 하위호환 게이트).
 * - patternId: 알 수 없는 값 → "dots"
 * - fg: #rgb/#rrggbb 외 → 기본 잉크색, 소문자 #rrggbb로 정규화
 * - bg: 유효 헥스만 채택(그 외/미설정 → 키 자체를 생략해 투명 유지)
 * - scale: [0.25, 4] 클램프, 비유한수 → 1
 */
export function normalizePatternSpec(value: unknown): StudioPatternSpec {
  const raw = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const patternId =
    typeof raw.patternId === "string" && PATTERN_BY_ID.has(raw.patternId as StudioPatternId)
      ? (raw.patternId as StudioPatternId)
      : DEFAULT_PATTERN_SPEC.patternId;
  const fg = normalizeHexColor(raw.fg, DEFAULT_PATTERN_FG);
  const bg = typeof raw.bg === "string" && isHexColor(raw.bg) ? normalizeHexColor(raw.bg, "#ffffff") : undefined;
  const scale = clampPatternScale(typeof raw.scale === "number" ? raw.scale : Number.NaN);
  return bg == null ? { patternId, fg, scale } : { patternId, fg, bg, scale };
}

/** 두 스펙이 시각적으로 동일한지(정규화 후 비교) — 패널의 활성 스와치 표시용. */
export function patternSpecsEqual(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a == null && b == null;
  const na = normalizePatternSpec(a);
  const nb = normalizePatternSpec(b);
  return (
    na.patternId === nb.patternId &&
    na.fg === nb.fg &&
    (na.bg ?? null) === (nb.bg ?? null) &&
    Math.abs(na.scale - nb.scale) < 1e-6
  );
}

// ---------------------------------------------------------------------------
// 패널 편집 헬퍼 — 전부 새 스펙 반환(무변이)
// ---------------------------------------------------------------------------

/** 패턴 종류만 교체(색·배율 유지) — 스와치 클릭. */
export function setPatternId(spec: StudioPatternSpec, patternId: StudioPatternId): StudioPatternSpec {
  return { ...normalizePatternSpec(spec), patternId };
}

/** 전경(잉크)색 변경 — 무효 색이면 기존 색 유지. */
export function setPatternFg(spec: StudioPatternSpec, fg: string): StudioPatternSpec {
  const safe = normalizePatternSpec(spec);
  return { ...safe, fg: normalizeHexColor(fg, safe.fg) };
}

/** 배경색 변경 — null이면 투명(bg 키 생략), 무효 색이면 흰색으로 폴백. */
export function setPatternBg(spec: StudioPatternSpec, bg: string | null): StudioPatternSpec {
  const safe = normalizePatternSpec(spec);
  if (bg == null) return { patternId: safe.patternId, fg: safe.fg, scale: safe.scale };
  return { ...safe, bg: normalizeHexColor(bg, "#ffffff") };
}

/** 배율 변경 — 범위 클램프. */
export function setPatternScale(spec: StudioPatternSpec, scale: number): StudioPatternSpec {
  return { ...normalizePatternSpec(spec), scale: clampPatternScale(scale) };
}

// ---------------------------------------------------------------------------
// 산출물 1 — SVG 타일 문자열/data URL(색 주입)
// ---------------------------------------------------------------------------

/**
 * 스펙 → 타일 1장 SVG 문자열. bg가 있으면 불투명 배경 rect를 깔고, 없으면 투명.
 * 색은 정규화된 #rrggbb만 주입되므로 마크업 이스케이프가 필요 없다.
 */
export function patternTileSvg(spec: StudioPatternSpec): string {
  const safe = normalizePatternSpec(spec);
  const def = getPatternDef(safe.patternId);
  const bgRect = safe.bg ? `<rect width="100%" height="100%" fill="${safe.bg}"/>` : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${def.tile}" height="${def.tile}" viewBox="0 0 ${def.tile} ${def.tile}">` +
    bgRect +
    def.inner(safe.fg) +
    `</svg>`
  );
}

/** 스펙 → <img> src/CSS url()에 바로 쓰는 data URL(encodeURIComponent 인코딩). */
export function patternDataUrl(spec: StudioPatternSpec): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(patternTileSvg(spec))}`;
}

/**
 * 타일 이미지 캐시 키 — patternId/fg/bg에만 의존한다(배율은 fillPatternScale로만
 * 적용되므로 키에서 제외 → 배율 슬라이더를 끌어도 이미지를 다시 로드하지 않는다).
 */
export function patternCacheKey(spec: StudioPatternSpec): string {
  const safe = normalizePatternSpec(spec);
  return `${safe.patternId}|${safe.fg}|${safe.bg ?? "-"}`;
}

// ---------------------------------------------------------------------------
// 산출물 2 — Konva fillPattern* props 계획
// ---------------------------------------------------------------------------

/**
 * Konva 노드에 스프레드할 패턴 채우기 props(미적용이면 전부 없음).
 * 이미지 타입은 제네릭 — 순수 모듈이 DOM HTMLImageElement 타입에 묶이지 않는다.
 */
export type KonvaPatternFillProps<TImage> = {
  fillPriority?: "pattern";
  fillPatternImage?: TImage;
  fillPatternRepeat?: "repeat";
  fillPatternScaleX?: number;
  fillPatternScaleY?: number;
};

/**
 * 스펙 + 로드된 타일 이미지 → Konva fillPattern* props.
 * 스펙이 없거나 이미지가 아직 없으면(null) 빈 객체를 돌려줘 스프레드가 no-op이 된다
 * — 타일 로드 전에는 기존 fill/그라데이션이 그대로 보이는 폴백 규약.
 * fillPriority="pattern"이 그라데이션 props 뒤에 스프레드되면 패턴이 이긴다
 * (우선순위: pattern > gradient > fill 단색).
 */
export function konvaPatternProps<TImage>(
  spec: StudioPatternSpec | null | undefined,
  image: TImage | null | undefined
): KonvaPatternFillProps<TImage> {
  if (spec == null || image == null) return {};
  const safe = normalizePatternSpec(spec);
  return {
    fillPriority: "pattern",
    fillPatternImage: image,
    fillPatternRepeat: "repeat",
    fillPatternScaleX: safe.scale,
    fillPatternScaleY: safe.scale,
  };
}

// ---------------------------------------------------------------------------
// 산출물 3 — 이미지 로더(주입형 팩토리)
// ---------------------------------------------------------------------------

/**
 * HTMLImageElement와 구조 호환하는 최소 이미지 형태 — 순수 모듈이라 DOM 타입을
 * 직접 참조하지 않는다. onload/onerror의 인자 타입은 never로 두어 DOM의
 * (ev: Event) => any 핸들러 시그니처가 구조적으로 대입 가능하다.
 */
export type PatternImageLike = {
  src: string;
  onload: ((ev: never) => unknown) | null;
  onerror: ((ev: never) => unknown) | null;
};

/** 이미지 팩토리 — 브라우저는 () => new Image(), 테스트는 가짜 이미지를 만든다. */
export type PatternImageFactory<TImage extends PatternImageLike> = () => TImage;

/**
 * 타일 src(data URL)를 팩토리로 만든 이미지에 로드한다.
 * 핸들러를 먼저 걸고 src를 대입하므로 동기 onload 구현(테스트 가짜)도 안전하다.
 */
export function loadPatternTileImage<TImage extends PatternImageLike>(
  src: string,
  createImage: PatternImageFactory<TImage>
): Promise<TImage> {
  return new Promise<TImage>((resolve, reject) => {
    const image = createImage();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("패턴 타일 이미지를 로드하지 못했습니다."));
    image.src = src;
  });
}

/** 스펙을 바로 타일 이미지로 로드하는 편의 함수 — loadPatternTileImage(patternDataUrl(spec)). */
export function loadPatternImage<TImage extends PatternImageLike>(
  spec: StudioPatternSpec,
  createImage: PatternImageFactory<TImage>
): Promise<TImage> {
  return loadPatternTileImage(patternDataUrl(spec), createImage);
}

// ---------------------------------------------------------------------------
// 산출물 4 — CSS 미리보기 스타일(패널 스와치·라이브 미리보기)
// ---------------------------------------------------------------------------

/** React CSSProperties에 그대로 스프레드 가능한 배경 스타일 묶음. */
export type PatternPreviewCss = {
  backgroundImage: string;
  backgroundSize: string;
  backgroundRepeat: "repeat";
};

/**
 * 스펙 → CSS 배경 스타일. background-size에 배율을 반영해 캔버스(fillPatternScale)와
 * 미리보기가 같은 밀도로 보인다. bg는 타일 SVG에 이미 구워져 있어 별도 색이 필요 없다.
 */
export function patternPreviewCss(spec: StudioPatternSpec): PatternPreviewCss {
  const safe = normalizePatternSpec(spec);
  const def = getPatternDef(safe.patternId);
  const size = Math.round(def.tile * safe.scale * 100) / 100;
  return {
    backgroundImage: `url("${patternDataUrl(safe)}")`,
    backgroundSize: `${size}px ${size}px`,
    backgroundRepeat: "repeat",
  };
}
