// 페이지 전체 컬러 그레이드 — CSS filter 문자열 + 비네트 오버레이/캔버스 합성.
// 이미지 픽셀 필터와 분리해 /studio 첫 청크가 이미지 보정 프리셋/엔진을 당겨오지 않게 한다.

export type PageGrade = {
  brightness: number; // 0.2..2, 기본 1 (CSS brightness())
  contrast: number; // 0.2..2, 기본 1
  saturation: number; // 0..3, 기본 1 (CSS saturate())
  hue: number; // -180..180, 기본 0 (CSS hue-rotate)
  sepia: number; // 0..1, 기본 0
  grayscale: number; // 0..1, 기본 0
  vignette: number; // 0..1, 기본 0 (CSS filter 아님 — 오버레이/캔버스로 그림)
};

export const DEFAULT_PAGE_GRADE: PageGrade = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  sepia: 0,
  grayscale: 0,
  vignette: 0,
};

export const PAGE_GRADE_RANGES: Record<keyof PageGrade, { min: number; max: number; step: number }> = {
  brightness: { min: 0.2, max: 2, step: 0.05 },
  contrast: { min: 0.2, max: 2, step: 0.05 },
  saturation: { min: 0, max: 3, step: 0.05 },
  hue: { min: -180, max: 180, step: 5 },
  sepia: { min: 0, max: 1, step: 0.05 },
  grayscale: { min: 0, max: 1, step: 0.05 },
  vignette: { min: 0, max: 1, step: 0.05 },
};

const PAGE_GRADE_KEYS = Object.keys(DEFAULT_PAGE_GRADE) as (keyof PageGrade)[];

/**
 * 과거 저장본 로드 안전장치 — 누락 키는 기본값, 숫자가 아닌 값은 기본값,
 * 범위 밖 숫자는 PAGE_GRADE_RANGES로 클램프한 새 객체를 반환.
 */
export function normalizePageGrade(g?: Partial<PageGrade> | null): PageGrade {
  const out: PageGrade = { ...DEFAULT_PAGE_GRADE };
  if (!g || typeof g !== "object") return out;
  for (const key of PAGE_GRADE_KEYS) {
    const raw = g[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const range = PAGE_GRADE_RANGES[key];
    out[key] = Math.min(range.max, Math.max(range.min, raw));
  }
  return out;
}

/** 모든 항목이 기본값(보정 없음)인지. */
export function isDefaultPageGrade(g: PageGrade): boolean {
  for (const key of PAGE_GRADE_KEYS) {
    if (g[key] !== DEFAULT_PAGE_GRADE[key]) return false;
  }
  return true;
}

// 소수점 둘째 자리까지, 불필요한 0 제거(1.10 → "1.1", 1.00 → "1").
function formatGradeNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// CSS filter 출력 순서 고정: brightness, contrast, saturate, hue-rotate, sepia, grayscale.
const CSS_FILTER_ORDER: { key: Exclude<keyof PageGrade, "vignette">; fn: string; unit: string }[] = [
  { key: "brightness", fn: "brightness", unit: "" },
  { key: "contrast", fn: "contrast", unit: "" },
  { key: "saturation", fn: "saturate", unit: "" },
  { key: "hue", fn: "hue-rotate", unit: "deg" },
  { key: "sepia", fn: "sepia", unit: "" },
  { key: "grayscale", fn: "grayscale", unit: "" },
];

/**
 * 페이지 그레이드 → CSS filter 문자열. 기본값과 같은 항목은 생략, 전부 기본이면 "".
 * 예: "brightness(1.1) saturate(0.8) hue-rotate(-15deg)".
 */
export function pageGradeToCssFilter(g: PageGrade): string {
  const parts: string[] = [];
  for (const { key, fn, unit } of CSS_FILTER_ORDER) {
    const value = g[key];
    if (value === DEFAULT_PAGE_GRADE[key]) continue;
    parts.push(`${fn}(${formatGradeNumber(value)}${unit})`);
  }
  return parts.join(" ");
}

// 비네트 톤 공유 — 미리보기(vignetteCss)와 내보내기(drawVignette)가 같은 값을 쓴다.
function vignetteStops(strength: number): { inner: number; alpha: number } {
  const s = Math.min(1, strength);
  return {
    inner: Math.round(70 - s * 25), // 어두워지기 시작하는 지점(%)
    alpha: Math.round(s * 70) / 100, // 가장자리 최대 어둡기
  };
}

/**
 * 미리보기 오버레이 div용 radial-gradient CSS 값. strength 0 이하면 "none".
 * 강도가 셀수록 더 안쪽에서 시작하고 가장자리가 더 어둡다.
 */
export function vignetteCss(strength: number): string {
  if (!Number.isFinite(strength) || strength <= 0) return "none";
  const { inner, alpha } = vignetteStops(strength);
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${alpha}) 100%)`;
}

export type VignetteCtx = {
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): { addColorStop(offset: number, color: string): void };
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
};

/**
 * 내보내기 캔버스에 비네트 합성. strength 0 이하면 아무것도 안 함.
 * vignetteCss 미리보기와 동일한 시작점/어둡기 톤으로 그린다.
 */
export function drawVignette(ctx: VignetteCtx, width: number, height: number, strength: number): void {
  if (!Number.isFinite(strength) || strength <= 0) return;
  if (!(width > 0) || !(height > 0)) return;
  const { inner, alpha } = vignetteStops(strength);
  const cx = width / 2;
  const cy = height / 2;
  const outerRadius = Math.sqrt(cx * cx + cy * cy);
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerRadius);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(Math.min(1, Math.max(0, inner / 100)), "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${alpha})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

export type PageGradePreset = { id: string; label: string; tip: string; grade: PageGrade };

// 웹툰 장면 무드 중심 페이지 그레이드 프리셋. grade 값은 PAGE_GRADE_RANGES 안.
export const PAGE_GRADE_PRESETS: PageGradePreset[] = [
  {
    id: "neutral",
    label: "기본",
    tip: "보정 없는 원본 페이지.",
    grade: { ...DEFAULT_PAGE_GRADE },
  },
  {
    id: "recall",
    label: "회상",
    tip: "빛바랜 세피아와 옅은 비네트로 과거 장면을 감쌉니다.",
    grade: { brightness: 1.05, contrast: 0.95, saturation: 0.7, hue: 0, sepia: 0.45, grayscale: 0, vignette: 0.25 },
  },
  {
    id: "night",
    label: "야간",
    tip: "어둡고 푸른 기운이 도는 밤 장면.",
    grade: { brightness: 0.75, contrast: 1.1, saturation: 0.7, hue: -10, sepia: 0, grayscale: 0, vignette: 0.4 },
  },
  {
    id: "dawn",
    label: "새벽",
    tip: "옅은 푸른빛과 낮은 채도의 새벽 공기.",
    grade: { brightness: 0.95, contrast: 0.95, saturation: 0.75, hue: 15, sepia: 0, grayscale: 0, vignette: 0.15 },
  },
  {
    id: "dusk",
    label: "황혼",
    tip: "노을빛이 스며드는 따뜻한 저녁.",
    grade: { brightness: 1, contrast: 1.05, saturation: 1.2, hue: -20, sepia: 0.2, grayscale: 0, vignette: 0.2 },
  },
  {
    id: "horror",
    label: "호러",
    tip: "핏기 없는 저채도와 짙은 비네트의 공포 무드.",
    grade: { brightness: 0.8, contrast: 1.35, saturation: 0.35, hue: 0, sepia: 0, grayscale: 0.3, vignette: 0.6 },
  },
  {
    id: "dreamy",
    label: "몽환",
    tip: "밝고 부드러운 빛이 번지는 꿈결 장면.",
    grade: { brightness: 1.1, contrast: 0.85, saturation: 0.85, hue: 10, sepia: 0.1, grayscale: 0, vignette: 0.1 },
  },
  {
    id: "mono-manuscript",
    label: "흑백 원고",
    tip: "잉크 대비를 살린 흑백 출판 원고 톤.",
    grade: { brightness: 1.05, contrast: 1.25, saturation: 0, hue: 0, sepia: 0, grayscale: 1, vignette: 0 },
  },
  {
    id: "rainy",
    label: "비 오는 날",
    tip: "채도를 낮춘 잿빛의 우중 장면.",
    grade: { brightness: 0.9, contrast: 0.95, saturation: 0.6, hue: 10, sepia: 0, grayscale: 0.15, vignette: 0.3 },
  },
  {
    id: "warm-afternoon",
    label: "따뜻한 오후",
    tip: "햇살이 내려앉은 포근한 오후의 톤.",
    grade: { brightness: 1.1, contrast: 1, saturation: 1.15, hue: -10, sepia: 0.15, grayscale: 0, vignette: 0 },
  },
];
