/**
 * Studio Auto Adjust Engine
 * 포토샵 "자동 보정(Auto Tone/Contrast/Color)" 류 — 이미지를 한 번 훑어 통계를 낸 뒤
 * 대비·톤·색·화이트밸런스를 자동 교정하고, 그 결과를 strength 비율로 원본과 블렌드한다.
 *   - contrast      : 휘도 히스토그램 양끝 0.5%를 클립한 lo/hi로 전 채널을 동일 계수로 스트레치.
 *   - tone          : 채널마다 각자 0.5% lo/hi로 스트레치(컬러 캐스트까지 펴짐).
 *   - color         : 그레이월드 — 각 채널 평균을 전체 평균에 맞춰 스케일(화이트밸런스).
 *   - whiteBalance  : 가장 밝은 영역(상위 1% 휘도) 평균색을 흰색으로 맞추도록 채널 스케일.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음), 빈/단색 이미지도 0-division 가드로 안전(항등 동작).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/** 자동 보정 모드. none=보정 없음. */
export type AutoMode = "none" | "contrast" | "tone" | "color" | "whiteBalance";

/** 선택 가능한 모드 목록(검증·UI 순회용). */
export const AUTO_MODES: AutoMode[] = ["none", "contrast", "tone", "color", "whiteBalance"];

/** 자동 보정 설정 — 모드 + 강도(0..100, 원본과의 블렌드 비율). */
export type AutoAdjust = { mode: AutoMode; strength: number };

/** 기본값 — 보정 없음(none), 강도는 켜자마자 100%가 되도록 100. */
export const DEFAULT_AUTO_ADJUST: AutoAdjust = { mode: "none", strength: 100 };

/** 강도 슬라이더 한 칸 범위 — 0..100, 1 단위. */
export const AUTO_STRENGTH_RANGE: { min: number; max: number; step: number } = {
  min: 0,
  max: 100,
  step: 1,
};

// 휘도(luma) 가중치 — 히스토그램·밝기 영역 산출의 기준.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// 히스토그램 양끝에서 잘라낼 비율(각 0.5%) — 노이즈/극단 픽셀에 휘둘리지 않게.
const CLIP_FRACTION = 0.005;
// 화이트밸런스 기준이 될 "가장 밝은 영역" 비율(상위 1%).
const HIGHLIGHT_FRACTION = 0.01;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 외부 입력 모드 문자열을 AutoMode로 안전 변환 — 무효면 "none".
function normalizeMode(raw: unknown): AutoMode {
  return typeof raw === "string" && (AUTO_MODES as string[]).includes(raw) ? (raw as AutoMode) : "none";
}

// 강도 한 값을 0..100으로 클램프, 숫자 아님은 기본 100.
function normalizeStrength(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_AUTO_ADJUST.strength;
  return Math.min(AUTO_STRENGTH_RANGE.max, Math.max(AUTO_STRENGTH_RANGE.min, raw));
}

/**
 * 과거 저장본/외부 입력 안전장치 — 모드는 화이트리스트 검증(무효→none),
 * 강도는 0..100 클램프(숫자 아님→100)한 새 객체를 반환.
 */
export function normalizeAutoAdjust(a?: Partial<AutoAdjust> | null): AutoAdjust {
  const src = a && typeof a === "object" ? a : {};
  return {
    mode: normalizeMode(src.mode),
    strength: normalizeStrength(src.strength),
  };
}

/** 모드가 none이거나 강도가 0 이하 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentityAutoAdjust(a: AutoAdjust): boolean {
  return a.mode === "none" || a.strength <= 0;
}

// ---------------------------------------------------------------------------
// 통계 헬퍼 — 한 번의 픽셀 순회로 채널별 합·히스토그램을 모은다.
// ---------------------------------------------------------------------------

// 한 채널 누적 히스토그램(256칸)에서 비율 frac만큼 잘린 하한값을 찾는다.
function clipLow(hist: Uint32Array, total: number, frac: number): number {
  const threshold = total * frac;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc > threshold) return v;
  }
  return 255;
}

// 한 채널 누적 히스토그램(256칸)에서 비율 frac만큼 잘린 상한값을 찾는다(위에서부터).
function clipHigh(hist: Uint32Array, total: number, frac: number): number {
  const threshold = total * frac;
  let acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc > threshold) return v;
  }
  return 0;
}

// (lo,hi) 구간을 0..255로 펴는 선형 계수 — 폭이 0이면 항등(scale=1, offset=0).
function stretchCoeffs(lo: number, hi: number): { scale: number; offset: number } {
  const span = hi - lo;
  if (span <= 0) return { scale: 1, offset: 0 };
  const scale = 255 / span;
  return { scale, offset: -lo * scale };
}

// ---------------------------------------------------------------------------
// 모드별 채널 변환 계산 — 각 채널에 대해 out = clamp(in*scale + offset)을 정의하는
// {scale, offset} 3쌍을 만든다. 통계가 비거나 단색이면 항등 계수를 돌려 no-op 보장.
// ---------------------------------------------------------------------------

type ChannelCoeffs = { scale: number; offset: number };
type RgbCoeffs = [ChannelCoeffs, ChannelCoeffs, ChannelCoeffs];

const IDENTITY_COEFF: ChannelCoeffs = { scale: 1, offset: 0 };
const IDENTITY_RGB: RgbCoeffs = [IDENTITY_COEFF, IDENTITY_COEFF, IDENTITY_COEFF];

// contrast: 휘도 히스토그램의 0.5% 양끝 lo/hi로 전 채널 동일 스트레치.
function contrastCoeffs(lumaHist: Uint32Array, total: number): RgbCoeffs {
  if (total <= 0) return IDENTITY_RGB;
  const lo = clipLow(lumaHist, total, CLIP_FRACTION);
  const hi = clipHigh(lumaHist, total, CLIP_FRACTION);
  const c = stretchCoeffs(lo, hi);
  return [c, c, c];
}

// tone: 채널별로 각자 0.5% lo/hi로 스트레치(컬러 캐스트 보정).
function toneCoeffs(hist: [Uint32Array, Uint32Array, Uint32Array], total: number): RgbCoeffs {
  if (total <= 0) return IDENTITY_RGB;
  return [0, 1, 2].map((ch) => {
    const h = hist[ch]!;
    return stretchCoeffs(clipLow(h, total, CLIP_FRACTION), clipHigh(h, total, CLIP_FRACTION));
  }) as RgbCoeffs;
}

// color: 그레이월드 — 각 채널 평균이 전체 평균(gray)에 맞도록 스케일(offset 0).
function colorCoeffs(sum: [number, number, number], total: number): RgbCoeffs {
  if (total <= 0) return IDENTITY_RGB;
  const meanR = sum[0] / total;
  const meanG = sum[1] / total;
  const meanB = sum[2] / total;
  const gray = (meanR + meanG + meanB) / 3;
  // 평균이 0인 채널(전부 검정)은 스케일이 무의미 → 항등.
  const scale = (mean: number): number => (mean > 0 ? gray / mean : 1);
  return [
    { scale: scale(meanR), offset: 0 },
    { scale: scale(meanG), offset: 0 },
    { scale: scale(meanB), offset: 0 },
  ];
}

// whiteBalance: 상위 1% 휘도 영역의 평균색을 흰색(=가장 밝은 채널)으로 맞추는 스케일.
function whiteBalanceCoeffs(img: StudioImageDataLike, lumaHist: Uint32Array, total: number): RgbCoeffs {
  if (total <= 0) return IDENTITY_RGB;
  // 상위 1%에 해당하는 휘도 컷오프(이상이면 하이라이트로 간주).
  const cut = clipHigh(lumaHist, total, HIGHLIGHT_FRACTION);
  const data = img.data;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    if (luma >= cut) {
      sumR += r;
      sumG += g;
      sumB += b;
      count++;
    }
  }
  if (count <= 0) return IDENTITY_RGB;
  const meanR = sumR / count;
  const meanG = sumG / count;
  const meanB = sumB / count;
  // 하이라이트 평균을 가장 밝은 채널 기준에 맞춰 흰색으로(가장 밝은 채널은 불변).
  const target = Math.max(meanR, meanG, meanB);
  if (target <= 0) return IDENTITY_RGB;
  const scale = (mean: number): number => (mean > 0 ? target / mean : 1);
  return [
    { scale: scale(meanR), offset: 0 },
    { scale: scale(meanG), offset: 0 },
    { scale: scale(meanB), offset: 0 },
  ];
}

// ---------------------------------------------------------------------------
// 통계 수집·계수 계산 — 슬라이더 프리뷰 등에서 픽셀 순회를 재사용한다.
// ---------------------------------------------------------------------------

export type ImagePixelStats = {
  total: number;
  sum: [number, number, number];
  histR: Uint32Array;
  histG: Uint32Array;
  histB: Uint32Array;
  lumaHist: Uint32Array;
};

/** 채널 합·히스토그램·휘도 히스토그램을 한 번의 순회로 수집한다. */
export function collectImageStats(data: Uint8ClampedArray | Uint8Array): ImagePixelStats {
  const total = (data.length / 4) | 0;
  const sum: [number, number, number] = [0, 0, 0];
  const histR = new Uint32Array(256);
  const histG = new Uint32Array(256);
  const histB = new Uint32Array(256);
  const lumaHist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    histR[r]!++;
    histG[g]!++;
    histB[b]!++;
    const luma = (LUMA_R * r + LUMA_G * g + LUMA_B * b) | 0;
    lumaHist[luma < 0 ? 0 : luma > 255 ? 255 : luma]!++;
  }
  return { total, sum, histR, histG, histB, lumaHist };
}

/** 모드별 RGB 계수를 계산한다(항등일 수 있음). */
export function computeAutoAdjustCoeffs(
  mode: AutoMode,
  stats: ImagePixelStats,
  img?: StudioImageDataLike
): RgbCoeffs {
  switch (mode) {
    case "contrast":
      return contrastCoeffs(stats.lumaHist, stats.total);
    case "tone":
      return toneCoeffs([stats.histR, stats.histG, stats.histB], stats.total);
    case "color":
      return colorCoeffs(stats.sum, stats.total);
    case "whiteBalance":
      return img ? whiteBalanceCoeffs(img, stats.lumaHist, stats.total) : IDENTITY_RGB;
    default:
      return IDENTITY_RGB;
  }
}

function isIdentityCoeffs(coeffs: RgbCoeffs): boolean {
  return coeffs.every((c) => c.scale === 1 && c.offset === 0);
}

export function applyCoeffsWithBlend(data: Uint8ClampedArray | Uint8Array, coeffs: RgbCoeffs, strength: number): void {
  if (isIdentityCoeffs(coeffs)) return;
  const cr = coeffs[0];
  const cg = coeffs[1];
  const cb = coeffs[2];
  const blend = Math.min(1, Math.max(0, strength / 100));
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const cR = clamp255(r * cr.scale + cr.offset);
    const cG = clamp255(g * cg.scale + cg.offset);
    const cB = clamp255(b * cb.scale + cb.offset);
    data[i] = r + (cR - r) * blend;
    data[i + 1] = g + (cG - g) * blend;
    data[i + 2] = b + (cB - b) * blend;
  }
}

// ---------------------------------------------------------------------------
// 적용 — 통계 → 모드별 계수 → strength 블렌드(제자리 변형)
// ---------------------------------------------------------------------------

/**
 * 자동 보정 제자리 적용 — 항등(none/strength<=0)이면 no-op.
 * 한 번의 순회로 채널 합·히스토그램을 모아 모드별 {scale,offset} 3쌍을 만든 뒤,
 *   corrected = clamp(in*scale + offset)
 *   out       = in + (corrected - in) * (strength/100)
 * 로 원본과 블렌드한다. 알파(+3) 보존. 빈/단색 이미지는 항등 계수로 떨어져 안전.
 */
export function applyAutoAdjust(img: StudioImageDataLike, a: AutoAdjust): void {
  const normalized = normalizeAutoAdjust(a);
  if (isIdentityAutoAdjust(normalized)) return;
  applyCoeffsWithBlend(img.data, computeAutoAdjustCoeffs(normalized.mode, collectImageStats(img.data), img), normalized.strength);
}

// 0..255 클램프(블렌드용 — Uint8ClampedArray 대입은 반올림만 보장하므로 사전 클램프).
function clamp255(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

// ---------------------------------------------------------------------------
// 자동 보정 프리셋 — 첫 항목은 항등(none), 나머지는 각 모드를 강도 100으로.
// 모든 value는 normalizeAutoAdjust를 통과(모드 유효·강도 0..100).
// ---------------------------------------------------------------------------

export type AutoAdjustPreset = { id: string; label: string; tip: string; value: AutoAdjust };

export const AUTO_ADJUST_PRESETS: AutoAdjustPreset[] = [
  {
    id: "none",
    label: "기본",
    tip: "자동 보정 없는 원본 톤.",
    value: normalizeAutoAdjust(DEFAULT_AUTO_ADJUST),
  },
  {
    id: "auto-contrast",
    label: "자동 대비",
    tip: "휘도 양끝을 0.5%씩 잘라 검정~흰색 폭을 또렷하게 펴줍니다.",
    value: normalizeAutoAdjust({ mode: "contrast", strength: 100 }),
  },
  {
    id: "auto-tone",
    label: "자동 톤",
    tip: "채널마다 따로 폭을 펴 칙칙한 톤과 옅은 색 치우침을 함께 잡습니다.",
    value: normalizeAutoAdjust({ mode: "tone", strength: 100 }),
  },
  {
    id: "auto-color",
    label: "자동 색보정",
    tip: "그레이월드로 채널 평균을 맞춰 전체 색 캐스트를 중립으로 되돌립니다.",
    value: normalizeAutoAdjust({ mode: "color", strength: 100 }),
  },
  {
    id: "auto-white-balance",
    label: "자동 화이트밸런스",
    tip: "가장 밝은 영역을 흰색 기준으로 맞춰 조명 색온도를 보정합니다.",
    value: normalizeAutoAdjust({ mode: "whiteBalance", strength: 100 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeAutoAdjust로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 autoMode(string)·autoStrength(number)를 읽어
 * normalizeAutoAdjust로 안전 변환 후 applyAutoAdjust. 항등(none/강도0)이거나 attrs가 비면 no-op.
 */
export function autoAdjustKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const a = normalizeAutoAdjust({
    mode: typeof attrs.autoMode === "string" ? (attrs.autoMode as AutoMode) : undefined,
    strength: typeof attrs.autoStrength === "number" ? attrs.autoStrength : undefined,
  });
  if (isIdentityAutoAdjust(a)) return;
  applyAutoAdjust(imageData, a);
}
