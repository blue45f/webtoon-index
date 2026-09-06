/**
 * Studio Selective HSL Engine
 * 라이트룸 "색상 혼합(HSL/Color)" 보정 — 8개 색 밴드(빨강~마젠타)별로
 * 색조(Hue)·채도(Sat)·휘도(Lum)를 독립 조정한다. 각 픽셀의 hue가 인접 밴드
 * 중심 사이 어디에 있는지로 삼각형 가중(합=1)을 구해 조정값을 부드럽게 섞는다.
 * 무채색(채도 0) 픽셀은 hue 가중을 0으로 둬 회색이 물들지 않게 보호한다.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 밴드 정의 — 고정 순서·중심 hue(도)
// ---------------------------------------------------------------------------

export type HslBand = "red" | "orange" | "yellow" | "green" | "aqua" | "blue" | "purple" | "magenta";

/** 8개 색 밴드 — 라이트룸과 동일한 고정 순서. */
export const HSL_BANDS: HslBand[] = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];

/** 각 밴드의 중심 hue(도). 색상환을 따라 단조 증가하며 마젠타→빨강이 0/360에서 감긴다. */
export const HSL_BAND_CENTER: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 280,
  magenta: 320,
};

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/**
 * 한 밴드의 조정값. 모두 -100..100.
 * - hue: (값/100)*30° 만큼 색조를 회전(양수=색상환 정방향).
 * - sat: 0..1 채도 스케일에 (값/100)을 더하고 클램프.
 * - lum: 0..1 휘도 스케일에 (값/100)을 더하고 클램프.
 */
export type BandAdjust = { hue: number; sat: number; lum: number };

export type SelectiveHsl = Record<HslBand, BandAdjust>;

/** 항등(보정 없음) — 모든 밴드 {hue:0, sat:0, lum:0}. */
export const DEFAULT_SELECTIVE_HSL: SelectiveHsl = {
  red: { hue: 0, sat: 0, lum: 0 },
  orange: { hue: 0, sat: 0, lum: 0 },
  yellow: { hue: 0, sat: 0, lum: 0 },
  green: { hue: 0, sat: 0, lum: 0 },
  aqua: { hue: 0, sat: 0, lum: 0 },
  blue: { hue: 0, sat: 0, lum: 0 },
  purple: { hue: 0, sat: 0, lum: 0 },
  magenta: { hue: 0, sat: 0, lum: 0 },
};

/** 슬라이더 한 칸 범위 — 모든 채널 -100..100, 1 단위. */
export const SELECTIVE_HSL_RANGE = { min: -100, max: 100, step: 1 } as const;

// 한 밴드의 채널 키 — 정규화·항등 판정·flat 변환에서 공통으로 순회한다(순서 고정).
const BAND_CHANNELS = ["hue", "sat", "lum"] as const;

// hue 슬라이더 -100..100을 ±30° 색조 회전으로 확장하는 계수.
const HUE_SHIFT_DEG = 30;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 채널 값을 -100..100으로 클램프, 숫자 아님은 0.
function clampAdjust(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  return Math.min(SELECTIVE_HSL_RANGE.max, Math.max(SELECTIVE_HSL_RANGE.min, raw));
}

// 한 밴드 조정값 정규화 — 누락/무효 채널은 0.
function normalizeBand(raw: unknown): BandAdjust {
  const src = raw && typeof raw === "object" ? (raw as Partial<BandAdjust>) : {};
  return {
    hue: clampAdjust(src.hue),
    sat: clampAdjust(src.sat),
    lum: clampAdjust(src.lum),
  };
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락 밴드·누락 채널은 0,
 * 숫자 아님은 0, 범위 밖은 -100..100으로 클램프한 새 객체를 반환.
 */
export function normalizeSelectiveHsl(s?: Partial<SelectiveHsl> | null): SelectiveHsl {
  const src = s && typeof s === "object" ? s : {};
  const out = {} as SelectiveHsl;
  for (const band of HSL_BANDS) {
    out[band] = normalizeBand(src[band]);
  }
  return out;
}

/** 모든 밴드의 모든 채널이 0 — 즉 픽셀을 건드리지 않는 항등 설정인지. */
export function isIdentitySelectiveHsl(s: SelectiveHsl): boolean {
  for (const band of HSL_BANDS) {
    const adj = s[band];
    if (adj.hue !== 0 || adj.sat !== 0 || adj.lum !== 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// RGB ↔ HSL 변환 — h는 0..360(도), s·l은 0..1.
// ---------------------------------------------------------------------------

/**
 * 0..255 RGB → HSL. h 0..360(도), s·l 0..1. 무채색이면 h=0, s=0.
 * 표준 변환(채도는 명도 기준 분모 사용).
 */
export function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

// hue 한 구간(0..1) → 채널값(0..1). hslToRgb 내부 보조.
function hueToChannel(p: number, q: number, tRaw: number): number {
  let t = tRaw;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/**
 * HSL(h 0..360, s·l 0..1) → 0..255 RGB(반올림). 표준 변환.
 * s=0이면 회색(l*255 동일 채널).
 */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s <= 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = (((h % 360) + 360) % 360) / 360;
  return {
    r: Math.round(hueToChannel(p, q, hk + 1 / 3) * 255),
    g: Math.round(hueToChannel(p, q, hk) * 255),
    b: Math.round(hueToChannel(p, q, hk - 1 / 3) * 255),
  };
}

// ---------------------------------------------------------------------------
// 밴드 가중 — pixel hue가 속한 인접 두 밴드 중심으로 삼각형 가중(합=1)
// ---------------------------------------------------------------------------

// 밴드 중심을 순서대로 펼친 배열(HSL_BANDS와 1:1). 적용 루프에서 재사용.
const BAND_CENTERS: number[] = HSL_BANDS.map((b) => HSL_BAND_CENTER[b]);

/**
 * hue(0..360)가 위치한 인접 두 밴드 중심 사이를 선형 보간해 8개 가중치를 만든다.
 * 색상환은 원형이라 마지막 밴드(magenta 320)→첫 밴드(red 0)는 40°를 건너 감긴다.
 * 반환 가중치 합은 항상 1(두 인접 밴드에만 분배, 나머지는 0).
 */
function bandWeights(h: number): number[] {
  const n = BAND_CENTERS.length;
  const w = new Array<number>(n).fill(0);
  // hue가 어느 인접 쌍 [i, i+1] 구간(원형)에 드는지 찾는다.
  for (let i = 0; i < n; i++) {
    const lo = BAND_CENTERS[i]!;
    const hiRaw = i + 1 < n ? BAND_CENTERS[i + 1]! : BAND_CENTERS[0]! + 360; // 감김
    // 이 구간에서의 위치를 0..1로. 마지막 구간은 hue를 +360 보정해 비교.
    const hh = h < lo ? h + 360 : h;
    if (hh >= lo && hh <= hiRaw) {
      const span = hiRaw - lo;
      const t = span > 0 ? (hh - lo) / span : 0;
      const hiIdx = i + 1 < n ? i + 1 : 0;
      w[i] = 1 - t;
      w[hiIdx] += t; // += : red가 첫·마지막 구간 양쪽에서 가중 받을 수 있어 누적
      return w;
    }
  }
  // 이론상 도달 불가(원형 구간이 0..360+를 모두 덮음) — 안전 폴백으로 red.
  w[0] = 1;
  return w;
}

// ---------------------------------------------------------------------------
// 적용 — 각 픽셀 HSL 변환 → 밴드 가중 조정 → RGB 복원(알파 보존)
// ---------------------------------------------------------------------------

// 0..1 클램프 보조.
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * 선택 색상 HSL 보정 제자리 적용 — 항등이면 no-op.
 * 각 픽셀:
 *   1) RGB→HSL.
 *   2) hue로 8밴드 삼각형 가중(합=1)을 구한다.
 *   3) 가중 합산:
 *        hueAdj = Σ w_b * band_b.hue,  satAdj = Σ w_b * band_b.sat,  lumAdj = Σ w_b * band_b.lum
 *   4) 무채색(s=0)이면 hueAdj=0(회색 보호).
 *   5) h += (hueAdj/100)*30°,  s = clamp01(s + satAdj/100),  l = clamp01(l + lumAdj/100).
 *   6) HSL→RGB로 복원, 알파(+3) 보존.
 */
export function applySelectiveHsl(img: StudioImageDataLike, s: SelectiveHsl): void {
  if (isIdentitySelectiveHsl(s)) return;

  // 밴드 조정값을 인덱스 배열로 펼쳐 픽셀 루프에서 가중 합산에 바로 쓴다.
  const hueAdj = HSL_BANDS.map((b) => s[b].hue);
  const satAdj = HSL_BANDS.map((b) => s[b].sat);
  const lumAdj = HSL_BANDS.map((b) => s[b].lum);
  const n = HSL_BANDS.length;

  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const hsl = rgbToHsl(r, g, b);

    const w = bandWeights(hsl.h);
    let hAcc = 0;
    let sAcc = 0;
    let lAcc = 0;
    for (let k = 0; k < n; k++) {
      const wk = w[k]!;
      if (wk === 0) continue;
      hAcc += wk * hueAdj[k]!;
      sAcc += wk * satAdj[k]!;
      lAcc += wk * lumAdj[k]!;
    }

    // 무채색은 색조 회전을 적용하지 않는다(회색이 물들지 않게).
    const isGray = hsl.s <= 0;
    const newH = isGray ? hsl.h : hsl.h + (hAcc / 100) * HUE_SHIFT_DEG;
    const newS = clamp01(hsl.s + sAcc / 100);
    const newL = clamp01(hsl.l + lAcc / 100);

    const out = hslToRgb(newH, newS, newL);
    data[i] = out.r;
    data[i + 1] = out.g;
    data[i + 2] = out.b;
    // 알파(+3)는 보존.
  }
}

// ---------------------------------------------------------------------------
// 웹툰 색감 프리셋 — 첫 항목은 항등, 나머지는 자주 쓰는 밴드 조합.
// 모든 value는 normalizeSelectiveHsl를 통과(각 채널 -100..100).
// ---------------------------------------------------------------------------

export type SelectiveHslPreset = { id: string; label: string; tip: string; value: SelectiveHsl };

export const SELECTIVE_HSL_PRESETS: SelectiveHslPreset[] = [
  {
    id: "none",
    label: "기본",
    tip: "보정 없는 원본 색상.",
    value: normalizeSelectiveHsl(DEFAULT_SELECTIVE_HSL),
  },
  {
    id: "autumn",
    label: "가을",
    tip: "주황·노랑 채도를 올리고 초록은 채도를 낮춰 노랗게 틀어 단풍 색감을 냅니다.",
    value: normalizeSelectiveHsl({
      orange: { hue: 0, sat: 30, lum: 5 },
      yellow: { hue: 0, sat: 28, lum: 0 },
      green: { hue: -25, sat: -35, lum: 0 },
    }),
  },
  {
    id: "clear-sky",
    label: "청량한 하늘",
    tip: "파랑 채도와 휘도를 끌어올려 맑고 청량한 하늘을 만듭니다.",
    value: normalizeSelectiveHsl({
      blue: { hue: 0, sat: 35, lum: 12 },
      aqua: { hue: 0, sat: 20, lum: 6 },
    }),
  },
  {
    id: "skin-tone",
    label: "피부 보정",
    tip: "주황(피부) 휘도를 살짝 올리고 채도를 낮춰 인물 피부를 화사하게 다듬습니다.",
    value: normalizeSelectiveHsl({
      orange: { hue: 3, sat: -12, lum: 10 },
      red: { hue: 0, sat: -6, lum: 4 },
    }),
  },
  {
    id: "vivid",
    label: "비비드",
    tip: "모든 색 밴드의 채도를 끌어올려 또렷하고 강렬한 색감을 만듭니다.",
    value: normalizeSelectiveHsl({
      red: { hue: 0, sat: 25, lum: 0 },
      orange: { hue: 0, sat: 25, lum: 0 },
      yellow: { hue: 0, sat: 25, lum: 0 },
      green: { hue: 0, sat: 25, lum: 0 },
      aqua: { hue: 0, sat: 25, lum: 0 },
      blue: { hue: 0, sat: 25, lum: 0 },
      purple: { hue: 0, sat: 25, lum: 0 },
      magenta: { hue: 0, sat: 25, lum: 0 },
    }),
  },
  {
    id: "vintage",
    label: "빈티지",
    tip: "전체 채도를 낮추고 노랑을 따뜻하게 시프트해 빛바랜 필름 색감을 냅니다.",
    value: normalizeSelectiveHsl({
      red: { hue: 0, sat: -25, lum: 0 },
      orange: { hue: 5, sat: -18, lum: 3 },
      yellow: { hue: 8, sat: -22, lum: 4 },
      green: { hue: 0, sat: -30, lum: 0 },
      blue: { hue: 0, sat: -28, lum: 0 },
    }),
  },
  {
    id: "cinema-teal",
    label: "시네마 틸",
    tip: "파랑·아쿠아 채도를 올려 그림자를 청록으로, 주황 피부는 따뜻하게 살린 영화 룩.",
    value: normalizeSelectiveHsl({
      blue: { hue: -8, sat: 30, lum: -4 },
      aqua: { hue: 0, sat: 28, lum: 0 },
      orange: { hue: 0, sat: 22, lum: 4 },
    }),
  },
  {
    id: "neon-pop",
    label: "네온 팝",
    tip: "마젠타·보라·파랑 채도를 끌어올려 사이버펑크 네온 색감을 연출합니다.",
    value: normalizeSelectiveHsl({
      magenta: { hue: 0, sat: 40, lum: 6 },
      purple: { hue: 0, sat: 35, lum: 4 },
      blue: { hue: 0, sat: 30, lum: 6 },
    }),
  },
];

// ---------------------------------------------------------------------------
// flat ↔ 객체 변환 — 8밴드 × 3채널(hue,sat,lum) = 24개, 순서 고정.
// Konva attrs/저장 직렬화에서 평탄한 number[]로 주고받는다.
// ---------------------------------------------------------------------------

/**
 * SelectiveHsl → 길이 24 number[]. 순서: HSL_BANDS 순으로 [hue,sat,lum] 반복.
 *   [red.hue, red.sat, red.lum, orange.hue, ..., magenta.lum]
 */
export function selectiveHslToFlat(s: SelectiveHsl): number[] {
  const flat: number[] = [];
  for (const band of HSL_BANDS) {
    const adj = s[band];
    for (const ch of BAND_CHANNELS) {
      flat.push(adj[ch]);
    }
  }
  return flat;
}

/**
 * 길이 24 number[] → SelectiveHsl. selectiveHslToFlat의 역변환.
 * 부족·무효 값은 normalizeSelectiveHsl 규칙대로 0/클램프 처리된다.
 */
export function flatToSelectiveHsl(flat: number[]): SelectiveHsl {
  const arr = Array.isArray(flat) ? flat : [];
  const partial: Partial<SelectiveHsl> = {};
  HSL_BANDS.forEach((band, bi) => {
    const base = bi * 3;
    partial[band] = {
      hue: arr[base] as number,
      sat: arr[base + 1] as number,
      lum: arr[base + 2] as number,
    };
  });
  return normalizeSelectiveHsl(partial);
}

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs.selectiveHsl(flat 24)는 외부 입력이므로 flatToSelectiveHsl로 안전 변환,
// 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs.selectiveHsl(길이 24 flat number[])를
 * flatToSelectiveHsl로 안전 변환한 뒤 applySelectiveHsl. 항등이거나
 * attrs/배열이 비면 no-op.
 */
export function selectiveHslKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const flat = attrs.selectiveHsl;
  if (!Array.isArray(flat)) return;
  const s = flatToSelectiveHsl(flat as number[]);
  if (isIdentitySelectiveHsl(s)) return;
  applySelectiveHsl(imageData, s);
}
