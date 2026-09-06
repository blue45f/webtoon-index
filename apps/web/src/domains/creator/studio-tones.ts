/**
 * Studio Screentone Library
 * 망점·선·교차선·그라데이션 스크린톤을 "타일링 가능한 SVG 문자열"로 모은 모듈.
 * 웹툰/만화 톤의 핵심은 패널에 클립해도 망점 크기가 변하지 않는 것 —
 * 그래서 모든 패턴은 patternUnits="userSpaceOnUse"로 도트/선 간격을 화면 좌표에 고정한다.
 * DOM/캔버스 의존 없음 — <img> src로 바로 붙는 data URL을 toneDataUrl로 만든다.
 * 전부 순수·결정적(랜덤 없음) — StudioPage와 단위 테스트가 공유한다.
 */

export type ToneCategory = "dot" | "line" | "gradient" | "crosshatch";

export type TonePreset = { id: string; label: string; category: ToneCategory; tip: string; svg: string };

// 패널을 넉넉히 덮는 기본 배치 크기(세로 컷 기준). 톤은 클립해서 쓰므로 캔버스보다 크게 잡는다.
export const TONE_DEFAULT_SIZE: { width: number; height: number } = { width: 480, height: 640 };

const W = TONE_DEFAULT_SIZE.width;
const H = TONE_DEFAULT_SIZE.height;

// 망점 잉크색 — 순흑보다 살짝 옅은 near-black(인쇄 톤 느낌). 배경은 투명(아트 위에 겹침).
const INK = "#1a1a1a";

// ---------------------------------------------------------------------------
// SVG 조립 헬퍼 — defs/pattern 본문을 받아 self-contained 타일 문서로 묶는다.
// userSpaceOnUse + 100% 채움 rect 조합이 "톤을 클립해도 도트 크기 고정"을 보장한다.
// ---------------------------------------------------------------------------

/**
 * 패턴 id(`tone-...`)와 타일 크기, 패턴 내부 SVG를 받아 타일링 SVG 문자열을 만든다.
 * 배경 rect는 fill="url(#id)"만 — 불투명 배경 없이 패턴 잉크만 아트 위에 얹는다.
 */
function tonePattern(id: string, tileW: number, tileH: number, inner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${tileW}" height="${tileH}">${inner}</pattern>` +
    `</defs>` +
    `<rect width="100%" height="100%" fill="url(#${id})"/>` +
    `</svg>`
  );
}

// 소수 셋째 자리에서 끊어 SVG 좌표 문자열을 짧게(불필요한 0 제거: 3.000 → "3").
function num(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// 망점(dot) — 고정 12px 타일 안에서 도트 반지름만 키워 밀도(잉크 면적 %)를 조절.
// 반지름 r은 면적률 d%에서 r = √(d/100 · tile²/π). 고밀도(60·75%)는 도트가 타일을
// 넘쳐 이웃 타일과 붙는데, 이게 진한 톤의 정상 동작이다(망점이 메워지는 느낌).
// ---------------------------------------------------------------------------

const DOT_TILE = 12;

/** 밀도 d%(잉크 면적)를 12px 타일 기준 도트 반지름으로 변환. */
function dotRadiusForDensity(density: number): number {
  const cov = Math.max(0, Math.min(100, density)) / 100;
  return Math.sqrt((cov * DOT_TILE * DOT_TILE) / Math.PI);
}

/** 단일 밀도 망점 프리셋 — 타일 중앙에 도트 1개(userSpaceOnUse로 크기 고정). */
function dotPreset(density: number, tip: string): TonePreset {
  const id = `tone-dot${density}`;
  const r = dotRadiusForDensity(density);
  const c = DOT_TILE / 2;
  const inner = `<circle cx="${num(c)}" cy="${num(c)}" r="${num(r)}" fill="${INK}"/>`;
  return {
    id,
    label: `망점 ${density}%`,
    category: "dot",
    tip,
    svg: tonePattern(id, DOT_TILE, DOT_TILE, inner),
  };
}

// ---------------------------------------------------------------------------
// 선(line) / 교차선(crosshatch) — 방향별 평행선. userSpaceOnUse라 선 굵기/간격 고정.
// 사선(45·135°)은 정사각 타일 안에서 대각선 한 줄 + 모서리 보정선을 그려 끊김 없이 이어지게 한다.
// ---------------------------------------------------------------------------

const LINE_STROKE = 2; // 선 굵기(px)

/** 수평선 패턴 본문 — 타일 위쪽에 가로줄 한 개. */
function horizontalInner(spacing: number): string {
  const y = spacing / 2;
  return `<line x1="0" y1="${num(y)}" x2="${num(spacing)}" y2="${num(y)}" stroke="${INK}" stroke-width="${LINE_STROKE}"/>`;
}

/** 수직선 패턴 본문 — 타일 왼쪽에 세로줄 한 개. */
function verticalInner(spacing: number): string {
  const x = spacing / 2;
  return `<line x1="${num(x)}" y1="0" x2="${num(x)}" y2="${num(spacing)}" stroke="${INK}" stroke-width="${LINE_STROKE}"/>`;
}

/**
 * 45°(↘) 사선 패턴 본문 — s×s 타일을 가로지르는 대각선 + 두 모서리 보정선.
 * 세 줄이 합쳐져 인접 타일 경계에서 매끄럽게 이어진다.
 */
function diag45Inner(s: string): string {
  const w = `stroke="${INK}" stroke-width="${LINE_STROKE}"`;
  return (
    `<line x1="0" y1="0" x2="${s}" y2="${s}" ${w}/>` +
    `<line x1="${`-${s}`}" y1="0" x2="${s}" y2="${`${parseFloat(s) * 2}`}" ${w}/>` +
    `<line x1="0" y1="${`-${s}`}" x2="${`${parseFloat(s) * 2}`}" y2="${s}" ${w}/>`
  );
}

/**
 * 135°(↙) 사선 패턴 본문 — 45°의 좌우 반전. s×s 타일 대각선 + 모서리 보정선.
 */
function diag135Inner(s: string): string {
  const w = `stroke="${INK}" stroke-width="${LINE_STROKE}"`;
  const sv = parseFloat(s);
  return (
    `<line x1="0" y1="${s}" x2="${s}" y2="0" ${w}/>` +
    `<line x1="0" y1="${`${sv * 2}`}" x2="${`${sv * 2}`}" y2="0" ${w}/>` +
    `<line x1="${`-${s}`}" y1="${s}" x2="${s}" y2="${`-${s}`}" ${w}/>`
  );
}

function linePreset(id: string, label: string, tip: string, tile: number, inner: string): TonePreset {
  return { id, label, category: "line", tip, svg: tonePattern(id, tile, tile, inner) };
}

function crosshatchPreset(id: string, label: string, tip: string, tile: number, inner: string): TonePreset {
  return { id, label, category: "crosshatch", tip, svg: tonePattern(id, tile, tile, inner) };
}

// ---------------------------------------------------------------------------
// 그라데이션(gradient) — 3밴드 거친 페이드. 한 타일을 세로 3등분해 위→아래로
// 성김→중간→촘촘 도트를 쌓는다. 결정적(랜덤 없음): 각 밴드는 고정 반지름 도트 행.
// ---------------------------------------------------------------------------

const GRAD_TILE_W = 12; // 가로 도트 간격
const GRAD_BAND_H = 12; // 밴드 1칸 높이(세로 도트 간격)
const GRAD_TILE_H = GRAD_BAND_H * 3; // 3밴드 = 36px 타일

/** 세로 위치 cy에 12px 간격 도트 한 행을 그린다(가로로 타일 반복). */
function gradBand(cy: number, density: number): string {
  const r = dotRadiusForDensity(density);
  const cx = GRAD_TILE_W / 2;
  return `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="${INK}"/>`;
}

/** 위→아래로 성김(12%)→중간(35%)→촘촘(60%) 도트가 쌓이는 3밴드 그라데이션 본문. */
function gradientDownInner(): string {
  const b0 = GRAD_BAND_H / 2; // 첫 밴드 중심
  const b1 = GRAD_BAND_H + GRAD_BAND_H / 2;
  const b2 = GRAD_BAND_H * 2 + GRAD_BAND_H / 2;
  return gradBand(b0, 12) + gradBand(b1, 35) + gradBand(b2, 60);
}

/** 아래→위로 진해지는 반전 그라데이션 본문(촘촘이 위로). */
function gradientUpInner(): string {
  const b0 = GRAD_BAND_H / 2;
  const b1 = GRAD_BAND_H + GRAD_BAND_H / 2;
  const b2 = GRAD_BAND_H * 2 + GRAD_BAND_H / 2;
  return gradBand(b0, 60) + gradBand(b1, 35) + gradBand(b2, 12);
}

function gradientPreset(id: string, label: string, tip: string, inner: string): TonePreset {
  return { id, label, category: "gradient", tip, svg: tonePattern(id, GRAD_TILE_W, GRAD_TILE_H, inner) };
}

// ---------------------------------------------------------------------------
// 프리셋 묶음 — 망점 6 + 선 6 + 교차선 2 + 그라데이션 2 = 16개.
// 각 svg는 self-contained·타일링·고유 pattern id. 화면 위 다중 톤 충돌 방지.
// ---------------------------------------------------------------------------

export const TONE_PRESETS: TonePreset[] = [
  // 망점 6단계(잉크 면적 %).
  dotPreset(10, "가장 옅은 톤 — 하늘·살결 같은 밝은 면을 살짝 깐다."),
  dotPreset(20, "옅은 그림자 톤 — 배경 면 분리에 무난하다."),
  dotPreset(30, "중간 톤 — 옷·소품의 기본 음영으로 두루 쓴다."),
  dotPreset(45, "진한 중간 톤 — 인물 그림자나 어두운 벽면에."),
  dotPreset(60, "어두운 톤 — 밤·실내 깊은 그늘 표현."),
  dotPreset(75, "거의 검정 — 가장 어두운 면을 망점 질감으로 메운다."),

  // 선 — 수평/수직 각 2간격.
  linePreset("tone-line-h-wide", "가로선 넓게", "스피드/잔잔한 배경 — 여유 있는 가로 줄무늬.", 12, horizontalInner(12)),
  linePreset("tone-line-h-tight", "가로선 촘촘", "강조 배경 — 빽빽한 가로선으로 면을 채운다.", 6, horizontalInner(6)),
  linePreset("tone-line-v-wide", "세로선 넓게", "비/창살 느낌 — 여유 있는 세로 줄무늬.", 12, verticalInner(12)),
  linePreset("tone-line-v-tight", "세로선 촘촘", "긴장된 배경 — 빽빽한 세로선.", 6, verticalInner(6)),

  // 사선 — 45°(↘)/135°(↙).
  linePreset("tone-line-d45", "사선 45°", "집중선 대용 — 우하향 사선으로 속도감.", 12, diag45Inner(num(12))),
  linePreset("tone-line-d135", "사선 135°", "반대 방향 사선 — 좌하향으로 분위기 전환.", 12, diag135Inner(num(12))),

  // 교차선(crosshatch) — 두 방향 결합.
  crosshatchPreset(
    "tone-cross-wide",
    "교차선 넓게",
    "수채·잉크 음영 — 가로+세로 격자로 중간 어둠.",
    12,
    horizontalInner(12) + verticalInner(12)
  ),
  crosshatchPreset(
    "tone-cross-tight",
    "교차선 촘촘",
    "깊은 그늘 — 빽빽한 가로+세로 격자.",
    6,
    horizontalInner(6) + verticalInner(6)
  ),

  // 그라데이션 — 3밴드 페이드(↓/↑).
  gradientPreset("tone-grad-down", "그라데이션 ↓", "위는 밝고 아래로 어두워지는 면 — 바닥 그림자/소실.", gradientDownInner()),
  gradientPreset("tone-grad-up", "그라데이션 ↑", "아래는 밝고 위로 어두워지는 면 — 하늘/천장 어둠.", gradientUpInner()),
];

// ---------------------------------------------------------------------------
// 변환/라벨 유틸
// ---------------------------------------------------------------------------

/**
 * SVG 문자열 → <img> src로 쓰는 data URL.
 * encodeURIComponent로 인코딩해 `#`/`<`/공백 등이 깨지지 않게 한다.
 */
export function toneDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const TONE_CATEGORY_LABELS: Record<ToneCategory, string> = {
  dot: "망점",
  line: "선",
  gradient: "그라데이션",
  crosshatch: "교차선",
};

/** 톤 카테고리 한글 라벨(필터 탭/그룹 헤더용). */
export function toneCategoryLabel(c: ToneCategory): string {
  return TONE_CATEGORY_LABELS[c];
}
