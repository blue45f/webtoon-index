/**
 * Studio Shadow / Highlight Engine
 * 포토샵 "섀도우/하이라이트(Shadow/Highlight)" 보정 —
 *   shadows:    휘도 기반 섀도 마스크(smoothstep) 가중으로 어두운 영역을 감마 리프트.
 *   highlights: 하이라이트 마스크 가중 선형 압축으로 날아간 밝은 영역을 되살린다(순백 포함).
 *   tonal width(각 0..100): 보정이 중간톤으로 얼마나 파고들지 — 마스크 smoothstep 범위.
 *   midtoneContrast(-50..50): 중간톤 가중 S-커브로 대비를 더하거나 뺀다.
 * 파라미터당 한 번만 256칸 휘도 LUT를 만들고(모듈 메모), 픽셀은 luma 비율로 RGB를
 * 스케일해 색상(hue)을 보존한다(알파 보존). 항등이면 zero-cost no-op.
 * Konva/DOM 의존 없음 — StudioPage 캔버스 로직과 단위 테스트가 공유한다.
 * 전부 순수·결정적(랜덤 없음).
 */

import type { StudioImageDataLike } from "./studio-filters";

// ---------------------------------------------------------------------------
// 파라미터 타입·기본값·범위
// ---------------------------------------------------------------------------

/**
 * 섀도우/하이라이트 보정.
 * shadows/highlights 0..100(보정량), shadowsWidth/highlightsWidth 0..100(톤 범위),
 * midtoneContrast -50..50(중간톤 대비).
 */
export type ShadowHighlight = {
  shadows: number;
  shadowsWidth: number;
  highlights: number;
  highlightsWidth: number;
  midtoneContrast: number;
};

/** 항등(보정 없음) — 보정량·대비 0. 톤 범위는 포토샵 기본 50(양은 0이라 효과 없음). */
export const DEFAULT_SHADOW_HIGHLIGHT: ShadowHighlight = {
  shadows: 0,
  shadowsWidth: 50,
  highlights: 0,
  highlightsWidth: 50,
  midtoneContrast: 0,
};

/** 섀도우/하이라이트 보정량 슬라이더 범위 — 0..100, 1 단위. */
export const SHADOW_HIGHLIGHT_AMOUNT_RANGE = { min: 0, max: 100, step: 1 } as const;

/** 톤 범위(tonal width) 슬라이더 범위 — 0..100, 1 단위. */
export const SHADOW_HIGHLIGHT_WIDTH_RANGE = { min: 0, max: 100, step: 1 } as const;

/** 중간톤 대비 슬라이더 범위 — -50..50, 1 단위. */
export const SHADOW_HIGHLIGHT_MIDTONE_RANGE = { min: -50, max: 50, step: 1 } as const;

// 휘도(luma) 가중치 — clarity/glow와 같은 Rec.601 계수.
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

// 섀도 감마 리프트 상한 — shadows=100에서 γ = 1/(1+0.8) ≈ 0.556.
const SHADOW_LIFT_STRENGTH = 0.8;
// 하이라이트 압축 기울기 상한 — highlights=100에서 마스크 시작점 기준 60% 압축(순백도 눌린다).
const HIGHLIGHT_RECOVERY_STRENGTH = 0.6;
// 중간톤 대비 상한 — midtoneContrast=±50에서 순수 중간톤 기울기 ×1.6 / ×0.4.
const MIDTONE_CONTRAST_STRENGTH = 0.6;

// ---------------------------------------------------------------------------
// 정규화·항등 판정
// ---------------------------------------------------------------------------

// 한 값을 [min,max]로 클램프, 숫자 아님은 fallback.
function clampTo(raw: unknown, min: number, max: number, fallback: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/**
 * 과거 저장본/외부 입력 안전장치 — 누락/숫자 아님은 기본값(보정량·대비 0, 톤 범위 50),
 * 범위 밖은 각 범위(양 0..100, 폭 0..100, 대비 -50..50)로 클램프한 새 객체를 반환.
 */
export function normalizeShadowHighlight(sh?: Partial<ShadowHighlight> | null): ShadowHighlight {
  const src = sh && typeof sh === "object" ? sh : {};
  const amount = SHADOW_HIGHLIGHT_AMOUNT_RANGE;
  const width = SHADOW_HIGHLIGHT_WIDTH_RANGE;
  const mid = SHADOW_HIGHLIGHT_MIDTONE_RANGE;
  return {
    shadows: clampTo(src.shadows, amount.min, amount.max, DEFAULT_SHADOW_HIGHLIGHT.shadows),
    shadowsWidth: clampTo(src.shadowsWidth, width.min, width.max, DEFAULT_SHADOW_HIGHLIGHT.shadowsWidth),
    highlights: clampTo(src.highlights, amount.min, amount.max, DEFAULT_SHADOW_HIGHLIGHT.highlights),
    highlightsWidth: clampTo(
      src.highlightsWidth,
      width.min,
      width.max,
      DEFAULT_SHADOW_HIGHLIGHT.highlightsWidth
    ),
    midtoneContrast: clampTo(src.midtoneContrast, mid.min, mid.max, DEFAULT_SHADOW_HIGHLIGHT.midtoneContrast),
  };
}

/** 보정량·중간톤 대비 모두 0 — 즉 픽셀을 건드리지 않는 항등 설정인지(톤 범위는 무관). */
export function isIdentityShadowHighlight(sh: ShadowHighlight): boolean {
  return sh.shadows === 0 && sh.highlights === 0 && sh.midtoneContrast === 0;
}

// ---------------------------------------------------------------------------
// 휘도 LUT — 파라미터가 같으면 재사용(모듈 메모). 전부 결정적.
// ---------------------------------------------------------------------------

// smoothstep(0..1) — 마스크 가장자리를 부드럽게.
function smoothstep01(t: number): number {
  const s = Math.min(1, Math.max(0, t));
  return s * s * (3 - 2 * s);
}

let lutCacheKey = "";
let lutCache: Float32Array | null = null;

/**
 * 256칸 휘도 LUT — l(0..255)마다 보정 후 휘도를 담는다.
 *   섀도 마스크  wS(l) = 1 - smoothstep(l / shadowSpan)              (어두울수록 1)
 *   하이 마스크  wH(l) = smoothstep((l - (255-hiSpan)) / hiSpan)      (밝을수록 1)
 *   리프트      v += (255·(l/255)^γs - l)·wS(l), γs = 1/(1 + shadows/100·0.8)  (γ<1 → 밝게)
 *   복구        v -= highlights/100·0.6·(l - (255-hiSpan))·wH(l)
 *               — 마스크 시작점 기준 선형 압축이라 밝을수록 복구량이 커지고 순백도 눌린다.
 *   중간톤 대비  v ← 128 + (v-128)·(1 + mc·0.6·wM(l)), wM(l) = 1 - |2l/255 - 1|
 * span = width/100·255 — 톤 범위가 클수록 보정이 중간톤 깊숙이 닿는다.
 * 마스크·중간톤 가중은 항상 원본 휘도 l 기준(포토샵과 동일 — 소스 톤에서 마스크 생성).
 */
export function buildShadowHighlightLut(sh: ShadowHighlight): Float32Array {
  const key = `${sh.shadows}|${sh.shadowsWidth}|${sh.highlights}|${sh.highlightsWidth}|${sh.midtoneContrast}`;
  if (lutCache && lutCacheKey === key) return lutCache;

  const lut = new Float32Array(256);
  const shadowAmount = sh.shadows / 100;
  const highlightAmount = sh.highlights / 100;
  const midUnit = sh.midtoneContrast / 50;
  const shadowSpan = Math.max(1, (sh.shadowsWidth / 100) * 255);
  const highlightSpan = Math.max(1, (sh.highlightsWidth / 100) * 255);
  const shadowGamma = 1 / (1 + shadowAmount * SHADOW_LIFT_STRENGTH);
  const highlightMaskStart = 255 - highlightSpan;

  for (let l = 0; l < 256; l += 1) {
    const unit = l / 255;
    let v = l;
    if (shadowAmount > 0) {
      const wS = 1 - smoothstep01(l / shadowSpan);
      const lifted = 255 * Math.pow(unit, shadowGamma);
      v += (lifted - l) * wS;
    }
    if (highlightAmount > 0) {
      const wH = smoothstep01((l - highlightMaskStart) / highlightSpan);
      v -= highlightAmount * HIGHLIGHT_RECOVERY_STRENGTH * (l - highlightMaskStart) * wH;
    }
    if (midUnit !== 0) {
      const wM = 1 - Math.abs((2 * l) / 255 - 1);
      v = 128 + (v - 128) * (1 + midUnit * MIDTONE_CONTRAST_STRENGTH * wM);
    }
    lut[l] = Math.min(255, Math.max(0, v));
  }

  lutCacheKey = key;
  lutCache = lut;
  return lut;
}

// ---------------------------------------------------------------------------
// 적용 — 휘도 LUT 비율로 RGB 스케일(hue 보존) 제자리 변형
// ---------------------------------------------------------------------------

/**
 * 섀도우/하이라이트 제자리 적용 — 항등이면 no-op(zero-cost).
 * 픽셀마다 Rec.601 휘도 → LUT로 새 휘도 → ratio = newLuma/luma 로 RGB를 함께 스케일해
 * 색상(hue)을 보존한다. 순흑(luma 0)은 비율이 정의되지 않으므로 그대로 둔다.
 * Uint8ClampedArray가 반올림·0..255 클램프, 알파(+3) 보존.
 */
export function applyShadowHighlight(img: StudioImageDataLike, sh: ShadowHighlight): void {
  if (isIdentityShadowHighlight(sh)) return;
  const lut = buildShadowHighlightLut(sh);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const luma = LUMA_R * r + LUMA_G * g + LUMA_B * b;
    if (luma <= 0) continue;
    const mapped = lut[Math.min(255, Math.round(luma))]!;
    const ratio = mapped / luma;
    if (ratio === 1) continue;
    data[i] = r * ratio;
    data[i + 1] = g * ratio;
    data[i + 2] = b * ratio;
  }
}

// ---------------------------------------------------------------------------
// 웹툰 섀도우/하이라이트 프리셋 — 첫 항목은 항등, 나머지는 자주 쓰는 명암 복구 조합.
// 모든 value는 normalizeShadowHighlight를 통과(양 0..100, 폭 0..100, 대비 -50..50).
// ---------------------------------------------------------------------------

export type ShadowHighlightPreset = { id: string; label: string; tip: string; value: ShadowHighlight };

export const SHADOW_HIGHLIGHT_PRESETS: ShadowHighlightPreset[] = [
  {
    id: "neutral",
    label: "기본",
    tip: "보정 없는 원본 명암.",
    value: normalizeShadowHighlight(DEFAULT_SHADOW_HIGHLIGHT),
  },
  {
    id: "lift-shadows",
    label: "섀도우 밝히기",
    tip: "어두운 영역만 감마 리프트로 밝혀 묻힌 디테일을 살립니다.",
    value: normalizeShadowHighlight({ shadows: 45 }),
  },
  {
    id: "recover-highlights",
    label: "하이라이트 복구",
    tip: "날아간 밝은 영역을 눌러 하늘·피부의 디테일을 되살립니다.",
    value: normalizeShadowHighlight({ highlights: 45 }),
  },
  {
    id: "backlight",
    label: "역광 보정",
    tip: "섀도우를 넓게 밝히고 하이라이트를 함께 눌러 역광 사진을 살립니다.",
    value: normalizeShadowHighlight({ shadows: 55, shadowsWidth: 60, highlights: 35 }),
  },
  {
    id: "midtone-punch",
    label: "미드톤 펀치",
    tip: "양끝을 살짝 복구하면서 중간톤 대비를 올려 또렷하게 만듭니다.",
    value: normalizeShadowHighlight({ shadows: 15, highlights: 15, midtoneContrast: 25 }),
  },
  {
    id: "soft-flat",
    label: "부드러운 플랫",
    tip: "명암 양끝을 모으고 중간톤 대비를 낮춰 잔잔한 플랫 톤을 만듭니다.",
    value: normalizeShadowHighlight({ shadows: 25, highlights: 25, midtoneContrast: -20 }),
  },
];

// ---------------------------------------------------------------------------
// Konva 등록용 — StudioPage가 커스텀 필터로 부착.
// attrs는 외부 입력이므로 normalizeShadowHighlight로 안전 변환, 항등/무효면 no-op.
// ---------------------------------------------------------------------------

/**
 * Konva 필터 함수 — node(`this`).attrs에서 shShadows/shShadowsWidth/shHighlights/
 * shHighlightsWidth/shMidtoneContrast(각 number)를 읽어 normalizeShadowHighlight로
 * 안전 변환 후 applyShadowHighlight. 항등이거나 attrs가 비면 no-op.
 */
export function shadowHighlightKonvaFilter(
  this: { attrs?: Record<string, unknown> },
  imageData: StudioImageDataLike
): void {
  const attrs = this.attrs;
  if (!attrs) return;
  const numberOr = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;
  const sh = normalizeShadowHighlight({
    shadows: numberOr(attrs.shShadows),
    shadowsWidth: numberOr(attrs.shShadowsWidth),
    highlights: numberOr(attrs.shHighlights),
    highlightsWidth: numberOr(attrs.shHighlightsWidth),
    midtoneContrast: numberOr(attrs.shMidtoneContrast),
  });
  if (isIdentityShadowHighlight(sh)) return;
  applyShadowHighlight(imageData, sh);
}
